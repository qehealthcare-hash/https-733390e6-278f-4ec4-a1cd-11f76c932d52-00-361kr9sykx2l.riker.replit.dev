"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { StatCard } from "@/components/ui/stat-card";
import { useAuth } from "@/components/providers/auth-provider";
import { request } from "@/lib/api-client";
import { formatCurrency } from "@/lib/formatters";

function currentPeriod() {
  var now = new Date();
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
}

export default function DashboardPage() {
  var auth = useAuth();
  var [kpis, setKpis] = useState(null);
  var [summaryError, setSummaryError] = useState("");

  useEffect(
    function () {
      if (!auth.session?.access_token) return;
      request("/reports/dashboard?period=" + encodeURIComponent(currentPeriod()), null, auth.session)
        .then(function (data) {
          setKpis(data);
          setSummaryError("");
        })
        .catch(function (error) {
          setSummaryError(error.message || "Unable to load dashboard KPIs");
        });
    },
    [auth.session]
  );

  return (
    <AuthGuard permission="dashboard.read">
      <AppShell title="Dashboard">
        <div className="page-grid">
          <section className="kpi-grid">
            <StatCard label="Total Patients" value={kpis?.patients_total ?? "—"} detail="All records in CRM" />
            <StatCard label="Active Patients" value={kpis?.patients_active ?? "—"} detail="Currently active cases" />
            <StatCard label="Staff" value={kpis?.employees_total ?? "—"} detail={String(kpis?.employees_active ?? "—") + " active"} />
            <StatCard label="Open Billings" value={kpis?.billings_open ?? "—"} detail={String(kpis?.billings_total ?? "—") + " total bills"} />
            <StatCard
              label="Billing Collected"
              value={kpis ? formatCurrency(kpis.billing_collected_amount) : "—"}
              detail={"Pending " + (kpis ? formatCurrency(kpis.billing_pending_amount) : "—")}
            />
            <StatCard
              label="Profit / Loss"
              value={kpis ? formatCurrency(kpis.profit_loss) : "—"}
              detail="Collected receipts minus payouts paid (this month)"
            />
            <StatCard label="Inquiries (month)" value={kpis?.inquiries_this_month ?? "—"} detail="Created in selected period" />
            <StatCard
              label="Duties completed"
              value={kpis?.duties_completed ?? "—"}
              detail={
                String(kpis?.duties_scheduled ?? "—") +
                " scheduled · " +
                String(kpis?.duties_active ?? "—") +
                " active"
              }
            />
          </section>
          {summaryError ? (
            <section className="panel module-shell">
              <div className="error-text">{summaryError}</div>
            </section>
          ) : null}
          <section className="panel module-shell">
            <h2 style={{ marginTop: 0 }}>Operations</h2>
            <div className="grid-3">
              <div className="panel card">
                <h3>React modules</h3>
                <div className="mini-muted">
                  Patients, inquiries, employees, duty calendar, billing, payouts, and audited reports run through{" "}
                  <code>/api/v1</code>.
                </div>
              </div>
              <div className="panel card">
                <h3>Classic CRM</h3>
                <div className="mini-muted">
                  Service diary, provisional bills, and legacy PDF flows remain in{" "}
                  <a href="/legacy" style={{ textDecoration: "underline" }}>
                    Classic CRM
                  </a>{" "}
                  until fully ported.
                </div>
              </div>
              <div className="panel card">
                <h3>Period</h3>
                <div className="mini-muted">
                  KPIs scoped to <strong>{kpis?.period || currentPeriod()}</strong>
                  {kpis?.range ? " (" + kpis.range.from.slice(0, 10) + " – " + kpis.range.to.slice(0, 10) + ")" : ""}.
                </div>
              </div>
            </div>
          </section>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
