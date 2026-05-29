"use client";

/**
 * Financial reports (M10 Pass D). Period helpers: `@/lib/reportUi`.
 * All data via `/api/v1/reports/*`.
 */

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { useAuth } from "@/components/providers/auth-provider";
import { request } from "@/lib/api-client";
import { downloadCsv } from "@/lib/csv";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { openPrintWindow } from "@/lib/print";
import { useNotify } from "@/components/ui/confirm-dialog";
import { REPORT_READ_ROLES } from "@/business/rbac";
import {
  currentPeriod,
  periodFromMonthInput,
  reportTabClass
} from "@/lib/reportUi";

function roleInList(role, list) {
  var normalized = String(role || "").trim().toLowerCase();
  return list.some(function (r) {
    return r.toLowerCase() === normalized;
  });
}

export default function ReportsPage() {
  var auth = useAuth();
  var canViewReports = roleInList(auth.profile?.role, REPORT_READ_ROLES);
  var notify = useNotify();
  var [period, setPeriod] = useState(currentPeriod());
  var [tab, setTab] = useState("overview");
  var [billing, setBilling] = useState(null);
  var [payout, setPayout] = useState(null);
  var [profitLoss, setProfitLoss] = useState(null);
  var [payroll, setPayroll] = useState(null);
  var [error, setError] = useState("");
  var [loading, setLoading] = useState(false);

  // Phase 12: detail tabs are now driven by server-side aggregation endpoints
  // — `/reports/{inquiries,patients,attendance,billings}` — so totals are
  // accurate for the entire period regardless of the paginated row slice.
  var [inquirySummary, setInquirySummary] = useState(null);
  var [inquiryRows, setInquiryRows] = useState([]);
  var [patientSummary, setPatientSummary] = useState(null);
  var [patientRows, setPatientRows] = useState([]);
  var [attendanceSummary, setAttendanceSummary] = useState(null);
  var [attendanceRows, setAttendanceRows] = useState([]);
  var [billingSummary, setBillingSummary] = useState(null);
  var [billingRows, setBillingRows] = useState([]);

  useEffect(
    function () {
      if (!auth.session?.access_token || !canViewReports) return;
      var q = "?period=" + encodeURIComponent(periodFromMonthInput(period));
      setLoading(true);
      setError("");
      Promise.all([
        request("/reports/billing-totals" + q, null, auth.session).catch(function () { return null; }),
        request("/reports/payout-totals" + q, null, auth.session).catch(function () { return null; }),
        request("/reports/profit-loss" + q, null, auth.session).catch(function () { return null; }),
        request("/reports/payroll" + q, null, auth.session).catch(function () { return null; })
      ])
        .then(function (result) {
          setBilling(result[0]);
          setPayout(result[1]);
          setProfitLoss(result[2]);
          setPayroll(result[3]);
        })
        .catch(function (err) {
          setError(err.message || "Unable to load reports");
        })
        .finally(function () {
          setLoading(false);
        });
    },
    [auth.session?.access_token, period, canViewReports]
  );

  useEffect(
    function () {
      if (!auth.session?.access_token || !canViewReports) return;
      var p = periodFromMonthInput(period);
      var qs = "?period=" + encodeURIComponent(p) + "&limit=200";
      var datasetErrors = [];
      Promise.all([
        request("/reports/inquiries" + qs, null, auth.session).catch(function (e) {
          datasetErrors.push("inquiries: " + (e.message || "load failed"));
          return null;
        }),
        request("/reports/patients" + qs, null, auth.session).catch(function (e) {
          datasetErrors.push("patients: " + (e.message || "load failed"));
          return null;
        }),
        request("/reports/attendance" + qs, null, auth.session).catch(function (e) {
          datasetErrors.push("attendance: " + (e.message || "load failed"));
          return null;
        }),
        request("/reports/billings" + qs, null, auth.session).catch(function (e) {
          datasetErrors.push("billings: " + (e.message || "load failed"));
          return null;
        })
      ]).then(function (result) {
        setInquirySummary(result[0] ? result[0].summary : null);
        setInquiryRows(result[0] && Array.isArray(result[0].rows) ? result[0].rows : []);
        setPatientSummary(result[1] ? result[1].summary : null);
        setPatientRows(result[1] && Array.isArray(result[1].rows) ? result[1].rows : []);
        setAttendanceSummary(result[2] ? result[2].summary : null);
        setAttendanceRows(result[2] && Array.isArray(result[2].rows) ? result[2].rows : []);
        setBillingSummary(result[3] ? result[3].summary : null);
        setBillingRows(result[3] && Array.isArray(result[3].rows) ? result[3].rows : []);
        if (datasetErrors.length) {
          setError("Some datasets failed to load — " + datasetErrors.join("; "));
        }
      });
    },
    [auth.session?.access_token, period, canViewReports]
  );

  var payrollRows = useMemo(function () { return (payroll && payroll.rows) || []; }, [payroll]);

  // Server-side totals (always accurate) with safe defaults for the empty
  // state. The page used to compute these from a 100-row sample; now the
  // numbers come from Supabase `count='exact'` aggregates.
  var inquiryStats = useMemo(
    function () {
      var defaults = {
        New: 0, Contacted: 0, FollowUp: 0, Negotiating: 0, Converted: 0, Closed: 0, Lost: 0
      };
      var by = Object.assign({}, defaults, (inquirySummary && inquirySummary.by_status) || {});
      var pot = (inquirySummary && inquirySummary.by_potential) || {};
      return {
        by: by,
        hot: pot.HOT || 0,
        warm: pot.WARM || 0,
        cold: pot.COLD || 0,
        total: inquirySummary ? inquirySummary.total : 0,
        followup_due: inquirySummary ? inquirySummary.followup_due : 0
      };
    },
    [inquirySummary]
  );

  var attendanceStats = useMemo(
    function () {
      var defaults = { PRESENT: 0, ABSENT: 0, LATE: 0, HALF_DAY: 0, LEAVE: 0, HOLIDAY: 0 };
      var by = Object.assign({}, defaults, (attendanceSummary && attendanceSummary.by_status) || {});
      var byEmployee = (attendanceSummary && attendanceSummary.by_employee) || [];
      return {
        by: by,
        byEmployee: byEmployee.map(function (e) {
          return {
            employee_id: e.employee_id,
            present: e.present || 0,
            absent: e.absent || 0,
            late: e.late || 0,
            leave: (e.leave || 0) + (e.holiday || 0)
          };
        }),
        total: attendanceSummary ? attendanceSummary.total : 0
      };
    },
    [attendanceSummary]
  );

  var patientStats = useMemo(
    function () {
      var byStatus = (patientSummary && patientSummary.by_status) || {};
      return {
        byStatus: byStatus,
        total: patientSummary ? patientSummary.total : 0
      };
    },
    [patientSummary]
  );

  function exportCsv(name, rows) {
    if (!rows || !rows.length) return;
    downloadCsv(name, rows);
  }

  function printSection(title, rows, columns) {
    if (!rows || !rows.length) {
      notify({ title: "Nothing to print", description: "There are no rows for the current selection." });
      return;
    }
    var thead = "<tr>" + columns.map(function (c) { return "<th>" + c.label + "</th>"; }).join("") + "</tr>";
    var tbody = rows
      .map(function (r) {
        return "<tr>" + columns.map(function (c) { return "<td>" + (c.format ? c.format(r) : (r[c.key] || "")) + "</td>"; }).join("") + "</tr>";
      })
      .join("");
    openPrintWindow(title, "<h2>" + title + "</h2><table><thead>" + thead + "</thead><tbody>" + tbody + "</tbody></table>");
  }

  return (
    <AuthGuard permission="reports.read">
      <AppShell title="Reports">
        <div className="page-grid">
          {!canViewReports ? (
            <ModuleShell
              title="Access restricted"
              description="Financial report APIs are limited to Admin, Manager, Accountant, and Executive roles."
            >
              <div className="helper-box">
                Your role can open this page via navigation but cannot load financial totals. Contact
                an Admin if you need report access.
              </div>
            </ModuleShell>
          ) : null}
          {canViewReports ? (
          <>
          <section className="kpi-grid">
            <StatCard
              label="Service total"
              value={billing ? formatCurrency(billing.service_total) : "—"}
              detail={billing ? String(billing.billings_count) + " billings" : ""}
            />
            <StatCard
              label="Collected"
              value={billing ? formatCurrency(billing.collected) : "—"}
              detail={billing ? "Pending " + formatCurrency(billing.pending) : ""}
            />
            <StatCard
              label="Net profit"
              value={profitLoss ? formatCurrency(profitLoss.net_profit) : "—"}
              detail={profitLoss ? "Revenue " + formatCurrency(profitLoss.revenue) : ""}
            />
            <StatCard
              label="Payout paid"
              value={payout ? formatCurrency(payout.paid) : "—"}
              detail={payout ? "Pending " + formatCurrency(payout.pending) : ""}
            />
          </section>

          <ModuleShell title="Period" description="Server-side aggregates from /api/v1/reports covering billing, payout, payroll, attendance, inquiries and patients. Totals are accurate for the entire period — detail tables paginate.">
            <div className="toolbar">
              <div className="field">
                <label htmlFor="reports-month-1">Month</label>
                <input id="reports-month-1"
                  type="month"
                  value={period}
                  onChange={function (event) {
                    setPeriod(event.target.value);
                  }}
                />
              </div>
            </div>
            <div className="button-row" style={{ flexWrap: "wrap" }}>
              <button type="button" className={reportTabClass(tab === "overview")} onClick={function () { setTab("overview"); }}>Overview</button>
              <button type="button" className={reportTabClass(tab === "billing")} onClick={function () { setTab("billing"); }}>Billing</button>
              <button type="button" className={reportTabClass(tab === "payout")} onClick={function () { setTab("payout"); }}>Payouts</button>
              <button type="button" className={reportTabClass(tab === "payroll")} onClick={function () { setTab("payroll"); }}>Payroll</button>
              <button type="button" className={reportTabClass(tab === "attendance")} onClick={function () { setTab("attendance"); }}>Attendance</button>
              <button type="button" className={reportTabClass(tab === "inquiry")} onClick={function () { setTab("inquiry"); }}>Inquiries</button>
              <button type="button" className={reportTabClass(tab === "patients")} onClick={function () { setTab("patients"); }}>Patients</button>
            </div>
            {loading ? <div className="mini-muted">Loading…</div> : null}
            {error ? <div className="error-text">{error}</div> : null}
          </ModuleShell>

          {tab === "overview" ? (
            <>
              <ModuleShell title="Billing totals">
                {billing ? (
                  <div className="stack mini-muted">
                    <div>Period: {billing.period}</div>
                    <div>Service total: {formatCurrency(billing.service_total)}</div>
                    <div>Collected: {formatCurrency(billing.collected)}</div>
                    <div>Pending: {formatCurrency(billing.pending)}</div>
                  </div>
                ) : (
                  <EmptyState title="No billing data" description="No billings or aggregates available for this period." />
                )}
              </ModuleShell>
              <ModuleShell title="Payout totals">
                {payout ? (
                  <div className="stack mini-muted">
                    <div>Gross: {formatCurrency(payout.gross)}</div>
                    <div>Net: {formatCurrency(payout.net)}</div>
                    <div>Paid: {formatCurrency(payout.paid)}</div>
                    <div>Pending: {formatCurrency(payout.pending)}</div>
                    {payout.partner_charge_ledger ? (
                      <div>Partner charges: {formatCurrency(payout.partner_charge_ledger)}</div>
                    ) : null}
                  </div>
                ) : (
                  <EmptyState title="No payout data" description="No payouts yet for this period." />
                )}
              </ModuleShell>
              <ModuleShell title="P&L">
                {profitLoss ? (
                  <div className="stack mini-muted">
                    <div>Revenue: {formatCurrency(profitLoss.revenue)}</div>
                    <div>Payouts paid: {formatCurrency(profitLoss.payouts_paid)}</div>
                    <div>Payouts pending: {formatCurrency(profitLoss.payouts_pending)}</div>
                    {profitLoss.partner_charge_ledger ? (
                      <div>Partner charges: {formatCurrency(profitLoss.partner_charge_ledger)}</div>
                    ) : null}
                    <div><strong>Net profit: {formatCurrency(profitLoss.net_profit)}</strong></div>
                  </div>
                ) : (
                  <EmptyState title="No P&L" description="No financial aggregate for this period." />
                )}
              </ModuleShell>
            </>
          ) : null}

          {tab === "billing" ? (
            <ModuleShell
              title="Billings — month report"
              actions={
                <div className="button-row">
                  <button
                    className="button secondary"
                    type="button"
                    onClick={function () {
                      exportCsv(
                        "billings-" + period + ".csv",
                        billingRows.map(function (b) {
                          return {
                            billing_id: b.id,
                            patient_name: b.patient_name || "",
                            patient_phone: b.patient_phone || "",
                            status: b.status,
                            service_total: b.totals ? b.totals.services : "",
                            collected: b.totals ? b.totals.receipts : "",
                            outstanding: b.totals ? b.totals.outstanding : "",
                            sec_dep: b.sec_dep,
                            paid_status: b.paid_status || "",
                            created: b.created_at || b.created || ""
                          };
                        }),
                        [
                          "billing_id",
                          "patient_name",
                          "patient_phone",
                          "status",
                          "service_total",
                          "collected",
                          "outstanding",
                          "sec_dep",
                          "paid_status",
                          "created"
                        ]
                      );
                    }}
                  >
                    CSV
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={function () {
                      printSection("Billings " + period, billingRows, [
                        { key: "id", label: "Bill" },
                        { key: "patient_name", label: "Patient" },
                        { key: "status", label: "Status" },
                        {
                          key: "totals",
                          label: "Outstanding",
                          format: function (r) {
                            return r.totals ? formatCurrency(r.totals.outstanding) : "—";
                          }
                        },
                        { key: "sec_dep", label: "Sec Dep", format: function (r) { return formatCurrency(r.sec_dep); } },
                        { key: "created_at", label: "Created", format: function (r) { return formatDate(r.created_at || r.created); } }
                      ]);
                    }}
                  >
                    Print
                  </button>
                </div>
              }
            >
              {billingSummary ? (
                <div className="helper-box">
                  Billed {formatCurrency(billingSummary.service_total)} ·
                  Received {formatCurrency(billingSummary.collected)} ·
                  Outstanding {formatCurrency(billingSummary.pending)} ·
                  {billingSummary.billings_count} billing
                  {billingSummary.billings_count === 1 ? "" : "s"}
                  {billingSummary.billings_count > billingRows.length
                    ? " (showing top " + billingRows.length + ")"
                    : ""}
                </div>
              ) : null}
              {!billingRows.length ? (
                <EmptyState title="No billings" description="No billings open in this period." />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>Bill</th><th>Patient</th><th>Status</th><th>Outstanding</th><th>Sec Dep</th><th>Created</th></tr>
                    </thead>
                    <tbody>
                      {billingRows.map(function (b) {
                        return (
                          <tr key={b.id}>
                            <td>{b.id}</td>
                            <td>{b.patient_name || b.patient_id}</td>
                            <td>{b.status}</td>
                            <td>{b.totals ? formatCurrency(b.totals.outstanding) : "—"}</td>
                            <td>{formatCurrency(b.sec_dep)}</td>
                            <td>{formatDate(b.created_at || b.created)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </ModuleShell>
          ) : null}

          {tab === "payout" ? (
            <ModuleShell title="Payout totals">
              {payout ? (
                <div className="stack">
                  <div className="helper-box">
                    Gross {formatCurrency(payout.gross)} · Net {formatCurrency(payout.net)} ·
                    Paid {formatCurrency(payout.paid)} · Pending {formatCurrency(payout.pending)}
                    {payout.partner_charge_ledger
                      ? " · Partner charges " + formatCurrency(payout.partner_charge_ledger)
                      : ""}
                  </div>
                </div>
              ) : (
                <EmptyState title="No data" description="No payouts in this period." />
              )}
            </ModuleShell>
          ) : null}

          {tab === "payroll" ? (
            <ModuleShell
              title="Payroll by employee"
              actions={
                <div className="button-row">
                  <button
                    className="button secondary"
                    type="button"
                    onClick={function () {
                      exportCsv(
                        "payroll-" + period + ".csv",
                        payrollRows.map(function (row) {
                          return {
                            employee_id: row.employee_id,
                            gross: row.gross_amount,
                            net: row.net_amount,
                            advance: row.advance,
                            deduction: row.deduction,
                            bonus: row.bonus,
                            duty_count: row.duty_count,
                            hours: row.hours,
                            status: row.status,
                            present: row.attendance ? row.attendance.present : "",
                            absent: row.attendance ? row.attendance.absent : "",
                            late: row.attendance ? row.attendance.late : "",
                            attendance_hours: row.attendance ? row.attendance.hours : ""
                          };
                        }),
                        [
                          "employee_id",
                          "gross",
                          "net",
                          "advance",
                          "deduction",
                          "bonus",
                          "duty_count",
                          "hours",
                          "status",
                          "present",
                          "absent",
                          "late",
                          "attendance_hours"
                        ]
                      );
                    }}
                  >
                    CSV
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={function () {
                      printSection("Payroll " + period, payrollRows, [
                        { key: "employee_id", label: "Employee" },
                        { key: "net_amount", label: "Net", format: function (r) { return formatCurrency(r.net_amount); } },
                        { key: "status", label: "Status" },
                        { key: "present", label: "Present", format: function (r) { return r.attendance ? r.attendance.present : "-"; } },
                        { key: "absent", label: "Absent", format: function (r) { return r.attendance ? r.attendance.absent : "-"; } }
                      ]);
                    }}
                  >
                    Print
                  </button>
                </div>
              }
            >
              {!payrollRows.length ? (
                <EmptyState title="No payroll" description="No payroll rows for this period." />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Net</th>
                        <th>Status</th>
                        <th>Present</th>
                        <th>Absent</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payrollRows.map(function (row) {
                        return (
                          <tr key={row.id || row.employee_id}>
                            <td>{row.employee_id}</td>
                            <td>{formatCurrency(row.net_amount)}</td>
                            <td>{row.status || "—"}</td>
                            <td>{row.attendance ? row.attendance.present : "—"}</td>
                            <td>{row.attendance ? row.attendance.absent : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </ModuleShell>
          ) : null}

          {tab === "attendance" ? (
            <ModuleShell
              title="Attendance summary"
              actions={
                <div className="button-row">
                  <button
                    className="button secondary"
                    type="button"
                    onClick={function () {
                      exportCsv("attendance-" + period + ".csv", attendanceStats.byEmployee);
                    }}
                  >
                    CSV
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={function () {
                      printSection("Attendance " + period, attendanceStats.byEmployee, [
                        { key: "employee_id", label: "Employee" },
                        { key: "present", label: "Present" },
                        { key: "absent", label: "Absent" },
                        { key: "late", label: "Late" },
                        { key: "leave", label: "Leave/Holiday" }
                      ]);
                    }}
                  >
                    Print
                  </button>
                </div>
              }
            >
              <div className="helper-box">
                Present {attendanceStats.by.PRESENT} · Absent {attendanceStats.by.ABSENT} ·
                Late {attendanceStats.by.LATE} · Half {attendanceStats.by.HALF_DAY} ·
                Leave {attendanceStats.by.LEAVE} · Holiday {attendanceStats.by.HOLIDAY}
              </div>
              {!attendanceStats.byEmployee.length ? (
                <EmptyState title="No records" description="No attendance was marked in this period." />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>Employee</th><th>Present</th><th>Absent</th><th>Late</th><th>Leave/Holiday</th></tr>
                    </thead>
                    <tbody>
                      {attendanceStats.byEmployee.map(function (r) {
                        return (
                          <tr key={r.employee_id}>
                            <td>{r.employee_id}</td>
                            <td>{r.present}</td>
                            <td>{r.absent}</td>
                            <td>{r.late}</td>
                            <td>{r.leave}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </ModuleShell>
          ) : null}

          {tab === "inquiry" ? (
            <ModuleShell
              title="Inquiry funnel"
              actions={
                <div className="button-row">
                  <button
                    className="button secondary"
                    type="button"
                    onClick={function () {
                      exportCsv("inquiries-" + period + ".csv", inquiryRows.map(function (i) {
                        return {
                          id: i.id,
                          name: i.name,
                          phone: i.phone,
                          area: i.area,
                          status: i.status,
                          potential: i.potential,
                          source: i.source,
                          created: i.created_at
                        };
                      }));
                    }}
                  >
                    CSV
                  </button>
                </div>
              }
            >
              <div className="helper-box">
                Total {inquiryStats.total} · Hot {inquiryStats.hot} · Warm {inquiryStats.warm} · Cold {inquiryStats.cold} ·
                Follow-ups due {inquiryStats.followup_due}
                {inquiryRows.length < inquiryStats.total
                  ? " (showing " + inquiryRows.length + " of " + inquiryStats.total + ")"
                  : ""}
              </div>
              <div className="kpi-grid">
                {Object.keys(inquiryStats.by).map(function (k) {
                  return <StatCard key={k} label={k} value={String(inquiryStats.by[k])} detail="" />;
                })}
              </div>
            </ModuleShell>
          ) : null}

          {tab === "patients" ? (
            <ModuleShell
              title="Patient registry summary"
              actions={
                <div className="button-row">
                  <button
                    className="button secondary"
                    type="button"
                    onClick={function () {
                      exportCsv("patients-" + period + ".csv", patientRows.map(function (p) {
                        return {
                          id: p.id,
                          name: p.name,
                          phone: p.phone,
                          area: p.area,
                          status: p.status,
                          created: p.created_at || p.created
                        };
                      }));
                    }}
                  >
                    CSV
                  </button>
                </div>
              }
            >
              <div className="helper-box">
                Total patients: {patientStats.total}
                {patientRows.length < patientStats.total
                  ? " (showing " + patientRows.length + " of " + patientStats.total + ")"
                  : ""}
              </div>
              <div className="kpi-grid">
                {Object.keys(patientStats.byStatus).map(function (k) {
                  return <StatCard key={k} label={k} value={String(patientStats.byStatus[k])} detail="" />;
                })}
              </div>
            </ModuleShell>
          ) : null}
          </>
          ) : null}
        </div>
      </AppShell>
    </AuthGuard>
  );
}
