"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { useAuth } from "@/components/providers/auth-provider";
import { request } from "@/lib/api-client";

export default function DashboardPage() {
  const auth = useAuth();
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState("");

  useEffect(
    function () {
      if (!auth.session?.access_token) return;
      request("/dashboard/summary", null, auth.session)
        .then(function (data) {
          setSummary(data);
          setSummaryError("");
        })
        .catch(function (error) {
          setSummaryError(error.message || "Unable to load dashboard summary");
        });
    },
    [auth.session]
  );

  return (
    <AuthGuard permission="dashboard.read">
      <AppShell title="Dashboard">
        <div className="page-grid">
          <section className="cards">
            {[
              ["Total Patients", summary?.totalPatients || 0],
              ["Active Patients", summary?.activePatients || 0],
              ["Monthly Revenue", "₹" + (summary?.monthlyRevenue || 0)],
              ["Profit / Loss", "₹" + (summary?.profitLoss || 0)]
            ].map(function (entry) {
              return (
                <div className="panel card" key={entry[0]}>
                  <h3>{entry[0]}</h3>
                  <strong>{entry[1]}</strong>
                </div>
              );
            })}
          </section>
          {summaryError ? <section className="panel module-shell"><div className="error-text">{summaryError}</div></section> : null}
          <section className="panel module-shell">
            <h2 style={{ marginTop: 0 }}>Daily Operations Snapshot</h2>
            <div className="grid-3">
              <div className="panel card">
                <h3>Patient lifecycle tracking</h3>
                <div className="mini-muted">Track active, closed, and pending closure cases in one place.</div>
              </div>
              <div className="panel card">
                <h3>Staff workload tracker</h3>
                <div className="mini-muted">Measure staff assignments and multi-patient service coverage.</div>
              </div>
              <div className="panel card">
                <h3>Pending payment alerts</h3>
                <div className="mini-muted">Accountants can chase invoices and payouts before month-end drift.</div>
              </div>
              <div className="panel card">
                <h3>Hot inquiries</h3>
                <div className="mini-muted">{summary?.hotInquiries || 0} high-priority leads need fast follow-up.</div>
              </div>
            </div>
          </section>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
