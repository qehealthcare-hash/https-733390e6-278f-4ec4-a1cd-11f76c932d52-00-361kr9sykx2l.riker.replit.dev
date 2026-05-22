"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { ModuleShell } from "@/components/ui/module-shell";
import { StatCard } from "@/components/ui/stat-card";
import { useAuth } from "@/components/providers/auth-provider";
import { request } from "@/lib/api-client";
import { downloadCsv } from "@/lib/csv";
import { formatCurrency } from "@/lib/formatters";

function periodFromMonthInput(monthValue) {
  if (monthValue && /^\d{4}-\d{2}$/.test(monthValue)) return monthValue;
  var now = new Date();
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
}

export default function ReportsPage() {
  var auth = useAuth();
  var [period, setPeriod] = useState(periodFromMonthInput(""));
  var [billing, setBilling] = useState(null);
  var [payout, setPayout] = useState(null);
  var [profitLoss, setProfitLoss] = useState(null);
  var [payroll, setPayroll] = useState(null);
  var [error, setError] = useState("");
  var [loading, setLoading] = useState(false);

  useEffect(
    function () {
      if (!auth.session?.access_token) return;
      var q = "?period=" + encodeURIComponent(periodFromMonthInput(period));
      setLoading(true);
      setError("");
      Promise.all([
        request("/reports/billing-totals" + q, null, auth.session),
        request("/reports/payout-totals" + q, null, auth.session),
        request("/reports/profit-loss" + q, null, auth.session),
        request("/reports/payroll" + q, null, auth.session)
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

  var payrollRows = useMemo(
    function () {
      return (payroll && payroll.rows) || [];
    },
    [payroll]
  );

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

          <ModuleShell
            title="Report period"
            description="Audited aggregates from /api/v1/reports (server-side math)"
            actions={
              <button
                className="button secondary"
                type="button"
                onClick={function () {
                  if (!profitLoss) return;
                  downloadCsv("profit-loss-" + period + ".csv", [
                    {
                      period: profitLoss.period,
                      revenue: profitLoss.revenue,
                      payouts_paid: profitLoss.payouts_paid,
                      payouts_pending: profitLoss.payouts_pending,
                      net_profit: profitLoss.net_profit
                    }
                  ]);
                }}
              >
                Export P&amp;L CSV
              </button>
            }
          >
            <div className="toolbar">
              <div className="field">
                <label>Month (YYYY-MM)</label>
                <input
                  type="month"
                  value={period}
                  onChange={function (event) {
                    setPeriod(event.target.value);
                  }}
                />
              </div>
            </div>
            {loading ? <div className="mini-muted">Loading…</div> : null}
            {error ? <div className="error-text">{error}</div> : null}
          </ModuleShell>

          <ModuleShell title="Billing totals">
            {billing ? (
              <div className="stack mini-muted">
                <div>Period: {billing.period}</div>
                <div>Service total: {formatCurrency(billing.service_total)}</div>
                <div>Collected: {formatCurrency(billing.collected)}</div>
                <div>Pending: {formatCurrency(billing.pending)}</div>
              </div>
            ) : (
              <div className="mini-muted">No data</div>
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
              <div className="mini-muted">No data</div>
            )}
          </ModuleShell>

          <ModuleShell
            title="Payroll by employee"
            actions={
              <button
                className="button secondary"
                type="button"
                onClick={function () {
                  downloadCsv(
                    "payroll-" + period + ".csv",
                    payrollRows.map(function (row) {
                      return {
                        employee_id: row.employee_id,
                        gross: row.gross_amount,
                        net: row.net_amount,
                        status: row.status,
                        present: row.attendance && row.attendance.present,
                        absent: row.attendance && row.attendance.absent
                      };
                    })
                  );
                }}
              >
                Export payroll CSV
              </button>
            }
          >
            {!payrollRows.length ? (
              <div className="mini-muted">No payroll rows for this period.</div>
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
        </div>
      </AppShell>
    </AuthGuard>
  );
}
