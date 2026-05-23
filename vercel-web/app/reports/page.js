"use client";

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

function currentPeriod() {
  var now = new Date();
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
}

function periodFromMonthInput(monthValue) {
  if (monthValue && /^\d{4}-\d{2}$/.test(monthValue)) return monthValue;
  return currentPeriod();
}

function tabClass(active) {
  return "button " + (active ? "primary" : "secondary");
}

export default function ReportsPage() {
  var auth = useAuth();
  var [period, setPeriod] = useState(currentPeriod());
  var [tab, setTab] = useState("overview");
  var [billing, setBilling] = useState(null);
  var [payout, setPayout] = useState(null);
  var [profitLoss, setProfitLoss] = useState(null);
  var [payroll, setPayroll] = useState(null);
  var [error, setError] = useState("");
  var [loading, setLoading] = useState(false);

  // additional datasets
  var [inquiries, setInquiries] = useState([]);
  var [patients, setPatients] = useState([]);
  var [attendance, setAttendance] = useState([]);
  var [billings, setBillings] = useState([]);

  useEffect(
    function () {
      if (!auth.session?.access_token) return;
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
    [auth.session, period]
  );

  useEffect(
    function () {
      if (!auth.session?.access_token) return;
      var p = periodFromMonthInput(period);
      var from = p + "-01";
      var ymParts = p.split("-");
      var year = Number(ymParts[0]);
      var month = Number(ymParts[1]);
      var endDay = new Date(year, month, 0).getDate();
      var to = p + "-" + String(endDay).padStart(2, "0");
      var datasetErrors = [];
      Promise.all([
        request("/inquiries?limit=500", null, auth.session).catch(function (e) {
          datasetErrors.push("inquiries: " + (e.message || "load failed"));
          return [];
        }),
        request("/patients?limit=1000", null, auth.session).catch(function (e) {
          datasetErrors.push("patients: " + (e.message || "load failed"));
          return [];
        }),
        request("/attendance?limit=2000&from=" + from + "&to=" + to, null, auth.session).catch(function (e) {
          datasetErrors.push("attendance: " + (e.message || "load failed"));
          return [];
        }),
        request("/billings?limit=500&period=" + p, null, auth.session).catch(function (e) {
          datasetErrors.push("billings: " + (e.message || "load failed"));
          return null;
        })
      ]).then(function (result) {
        var inqs = Array.isArray(result[0]) ? result[0] : (result[0] && result[0].rows) || [];
        var pats = Array.isArray(result[1]) ? result[1] : (result[1] && result[1].rows) || [];
        var atts = Array.isArray(result[2]) ? result[2] : (result[2] && result[2].rows) || [];
        var bills = result[3] && Array.isArray(result[3].rows) ? result[3].rows : [];
        // Scope the unfiltered lists to the selected period using the
        // best-available date field so on-screen totals match the period header.
        function inPeriod(dateStr) {
          if (!dateStr) return false;
          var s = String(dateStr).slice(0, 10);
          return s >= from && s <= to;
        }
        var scopedInqs = inqs.filter(function (r) {
          return inPeriod(r.created_at || r.created || r.date);
        });
        var scopedPats = pats.filter(function (r) {
          return inPeriod(r.created_at || r.created || r.start_date);
        });
        setInquiries(scopedInqs);
        setPatients(scopedPats);
        setAttendance(atts);
        setBillings(bills);
        if (datasetErrors.length) {
          setError("Some datasets failed to load — " + datasetErrors.join("; "));
        }
      });
    },
    [auth.session, period]
  );

  var payrollRows = useMemo(function () { return (payroll && payroll.rows) || []; }, [payroll]);

  var inquiryStats = useMemo(
    function () {
      var by = { New: 0, Contacted: 0, FollowUp: 0, Negotiating: 0, Converted: 0, Closed: 0, Lost: 0 };
      var hot = 0, warm = 0, cold = 0;
      inquiries.forEach(function (r) {
        if (by[r.status] !== undefined) by[r.status] += 1;
        if (r.potential === "HOT") hot += 1;
        else if (r.potential === "WARM") warm += 1;
        else if (r.potential === "COLD") cold += 1;
      });
      return { by: by, hot: hot, warm: warm, cold: cold, total: inquiries.length };
    },
    [inquiries]
  );

  var attendanceStats = useMemo(
    function () {
      var by = { PRESENT: 0, ABSENT: 0, LATE: 0, HALF_DAY: 0, LEAVE: 0, HOLIDAY: 0 };
      var byEmployee = {};
      attendance.forEach(function (r) {
        if (by[r.status] !== undefined) by[r.status] += 1;
        var emp = r.employee_id || "—";
        byEmployee[emp] = byEmployee[emp] || { employee_id: emp, present: 0, absent: 0, late: 0, leave: 0 };
        if (r.status === "PRESENT") byEmployee[emp].present += 1;
        else if (r.status === "ABSENT") byEmployee[emp].absent += 1;
        else if (r.status === "LATE") byEmployee[emp].late += 1;
        else if (r.status === "LEAVE" || r.status === "HOLIDAY") byEmployee[emp].leave += 1;
      });
      return { by: by, byEmployee: Object.values(byEmployee), total: attendance.length };
    },
    [attendance]
  );

  var patientStats = useMemo(
    function () {
      var byStatus = {};
      patients.forEach(function (p) {
        var s = p.status || "Unknown";
        byStatus[s] = (byStatus[s] || 0) + 1;
      });
      return { byStatus: byStatus, total: patients.length };
    },
    [patients]
  );

  function exportCsv(name, rows) {
    if (!rows || !rows.length) return;
    downloadCsv(name, rows);
  }

  function printSection(title, rows, columns) {
    if (!rows || !rows.length) {
      window.alert("Nothing to print");
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

          <ModuleShell title="Period" description="Audited monthly aggregates from /api/v1/reports + client-side analytics for inquiries, patients, attendance and billing.">
            <div className="toolbar">
              <div className="field">
                <label>Month</label>
                <input
                  type="month"
                  value={period}
                  onChange={function (event) {
                    setPeriod(event.target.value);
                  }}
                />
              </div>
            </div>
            <div className="button-row" style={{ flexWrap: "wrap" }}>
              <button type="button" className={tabClass(tab === "overview")} onClick={function () { setTab("overview"); }}>Overview</button>
              <button type="button" className={tabClass(tab === "billing")} onClick={function () { setTab("billing"); }}>Billing</button>
              <button type="button" className={tabClass(tab === "payout")} onClick={function () { setTab("payout"); }}>Payouts</button>
              <button type="button" className={tabClass(tab === "payroll")} onClick={function () { setTab("payroll"); }}>Payroll</button>
              <button type="button" className={tabClass(tab === "attendance")} onClick={function () { setTab("attendance"); }}>Attendance</button>
              <button type="button" className={tabClass(tab === "inquiry")} onClick={function () { setTab("inquiry"); }}>Inquiries</button>
              <button type="button" className={tabClass(tab === "patients")} onClick={function () { setTab("patients"); }}>Patients</button>
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
                      exportCsv("billings-" + period + ".csv", billings.map(function (b) {
                        return {
                          id: b.id,
                          patient_id: b.patient_id,
                          status: b.status,
                          sec_dep: b.sec_dep,
                          created: b.created_at || b.created || ""
                        };
                      }));
                    }}
                  >
                    CSV
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={function () {
                      printSection("Billings " + period, billings, [
                        { key: "id", label: "ID" },
                        { key: "patient_id", label: "Patient" },
                        { key: "status", label: "Status" },
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
              {!billings.length ? (
                <EmptyState title="No billings" description="No billings open in this period." />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>Bill</th><th>Patient</th><th>Status</th><th>Sec Dep</th><th>Created</th></tr>
                    </thead>
                    <tbody>
                      {billings.map(function (b) {
                        return (
                          <tr key={b.id}>
                            <td>{b.id}</td>
                            <td>{b.patient_id}</td>
                            <td>{b.status}</td>
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
                      exportCsv("payroll-" + period + ".csv", payrollRows.map(function (row) {
                        return {
                          employee_id: row.employee_id,
                          gross: row.gross_amount,
                          net: row.net_amount,
                          status: row.status,
                          present: row.attendance && row.attendance.present,
                          absent: row.attendance && row.attendance.absent
                        };
                      }));
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
                      exportCsv("inquiries-" + period + ".csv", inquiries.map(function (i) {
                        return {
                          id: i.id,
                          name: i.patient_name || i.name,
                          phone: i.mobile || i.phone,
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
                Total {inquiryStats.total} · Hot {inquiryStats.hot} · Warm {inquiryStats.warm} · Cold {inquiryStats.cold}
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
                      exportCsv("patients-" + period + ".csv", patients.map(function (p) {
                        return {
                          id: p.id,
                          name: p.full_name || p.name,
                          phone: p.mobile || p.phone,
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
              <div className="helper-box">Total patients: {patientStats.total}</div>
              <div className="kpi-grid">
                {Object.keys(patientStats.byStatus).map(function (k) {
                  return <StatCard key={k} label={k} value={String(patientStats.byStatus[k])} detail="" />;
                })}
              </div>
            </ModuleShell>
          ) : null}
        </div>
      </AppShell>
    </AuthGuard>
  );
}
