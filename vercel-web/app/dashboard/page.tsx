"use client";

/**
 * Dashboard page. (Module 3 audit, 2026-05-29)
 *
 * This is the operator's daily landing page. Goal of the M3 rewrite:
 *
 *   - M1  — TypeScript: typed `DashboardKpis` from `@/business/reportRules`
 *           so a typo like `kpis.patients_totall` fails the build.
 *   - C1  — proper loading state on every card (skeleton via StatCard's
 *           `loading` prop) instead of frozen "—" placeholders.
 *   - C2  — visible "Retry" button on error; one automatic retry on 5xx.
 *   - H1  — generation guard + AbortController so stale fetches can never
 *           overwrite fresher data (e.g. when the operator changes the
 *           period during an in-flight request).
 *   - H2  — period picker: This month / Last month / a custom YYYY-MM
 *           input. The browser's native `<input type="month">` covers
 *           every supported platform; no extra dependency.
 *   - H3  — `currentPeriod()` is IST-aware (see `@/lib/period`) so the
 *           dashboard shows the user's calendar month, never the UTC one.
 *   - H4  — already-shipped: cash + accrual P/L cards.
 *   - L1  — `useEffect` depends on the token string, not the session
 *           object identity, so a re-render of the auth provider doesn't
 *           force a refetch.
 *   - L2  — "Staff" card relabelled to "Employees" to match the field
 *           name (employees_total / employees_active).
 *   - L3  — counts get thousand separators via `Intl.NumberFormat`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { AuthGuard } from "@/components/state/auth-guard";
import { StatCard } from "@/components/ui/stat-card";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/components/providers/auth-provider";
import { reportsClient } from "@/lib/clients";
import { onDataInvalidated } from "@/lib/data-invalidation";
import { formatCurrency } from "@/lib/formatters";
import {
  currentPeriod,
  formatPeriodLabel,
  isValidPeriod,
  previousPeriod
} from "@/lib/period";
import type { DashboardKpis } from "@/business/reportRules";

const countFormatter = new Intl.NumberFormat("en-IN");

function fmtCount(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return countFormatter.format(Number(value));
}

/** All zeros → "no activity this period" empty-state hint. */
function isEmptyPeriod(k: DashboardKpis): boolean {
  return (
    k.patients_total === 0 &&
    k.employees_total === 0 &&
    k.inquiries_this_month === 0 &&
    k.duties_completed === 0 &&
    k.duties_scheduled === 0 &&
    k.duties_active === 0 &&
    k.billing_collected_amount === 0 &&
    k.billing_total_amount === 0
  );
}

export default function DashboardPage() {
  // `useAuth()` is typed loosely from the .js provider; `AuthGuard` above
  // guarantees we're rendered inside the provider so this is non-null in
  // practice. Explicit narrowing keeps TS happy without leaking the
  // assumption into other call sites.
  const auth = useAuth() as {
    session?: { access_token?: string } | null;
  } | null;
  const accessToken = auth?.session?.access_token ?? "";
  // P1-B: pin latest session so memoized fetchKpis never reads a stale
  // session object after onAuthStateChange re-renders the provider.
  const sessionRef = useRef(auth?.session ?? null);
  sessionRef.current = auth?.session ?? null;

  const [period, setPeriod] = useState<string>(() => currentPeriod());
  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [error, setErrorState] = useState<string>("");
  const toast = useToast();
  const setError = useCallback(
    function (msg: string) {
      const text = String(msg || "");
      setErrorState(text);
      if (text) toast.error(text);
    },
    [toast]
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [retryCount, setRetryCount] = useState<number>(0);

  // Generation guard — only the latest fetch may call setState.
  // Strictly necessary even with AbortController because aborted fetches
  // can still race the next handler in dev/strict-mode double-fires.
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // Single one-shot auto-retry for transient 5xx, gated by ref so
  // re-renders don't accidentally schedule a second retry.
  const autoRetryRef = useRef<boolean>(false);

  const fetchKpis = useCallback(
    async (targetPeriod: string, isAutoRetry: boolean = false) => {
      if (!accessToken) return;
      if (!isValidPeriod(targetPeriod)) {
        setError("Invalid period — expected YYYY-MM.");
        return;
      }

      // Cancel any prior in-flight request.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const gen = ++generationRef.current;

      setLoading(true);
      if (!isAutoRetry) setError("");

      try {
        const session = sessionRef.current;
        if (!session) return;
        const data = (await reportsClient.dashboard(session, targetPeriod, {
          signal: controller.signal
        })) as DashboardKpis;
        if (gen !== generationRef.current) return; // stale
        setKpis(data);
        setError("");
        setLastUpdated(new Date());
        autoRetryRef.current = false;
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        if (gen !== generationRef.current) return;
        const e = err as { message?: string; status?: number; name?: string };
        if (e?.name === "AbortError") return;
        const message = e?.message || "Unable to load dashboard KPIs";
        setError(message);

        // M3-C2: one automatic retry on transient 5xx. Manual retry
        // button remains available regardless.
        const transient5xx = typeof e?.status === "number" && e.status >= 500;
        if (transient5xx && !autoRetryRef.current) {
          autoRetryRef.current = true;
          window.setTimeout(() => {
            // Only retry if nothing else moved us along in the meantime.
            if (gen === generationRef.current) {
              void fetchKpis(targetPeriod, true);
            }
          }, 2000);
        }
      } finally {
        if (gen === generationRef.current) {
          setLoading(false);
        }
      }
    },
    [accessToken, setError]
  );

  useEffect(() => {
    if (!accessToken) return;
    void fetchKpis(period);
    return () => {
      abortRef.current?.abort();
    };
    // L1: depend on the token STRING + period STRING, not the session
    // object identity. Avoids spurious refetches when the auth provider
    // re-renders without the token changing.
  }, [accessToken, period, retryCount, fetchKpis]);

  // Dashboard has no Supabase realtime subscription, so without this it stayed
  // stale after a mutation in another module until a manual period change.
  // Refetch the current period whenever a write broadcasts an invalidation.
  useEffect(() => {
    if (!accessToken) return undefined;
    return onDataInvalidated(function () {
      void fetchKpis(period);
    });
  }, [accessToken, period, fetchKpis]);

  const onManualRetry = useCallback(() => {
    autoRetryRef.current = false;
    setRetryCount((n) => n + 1);
  }, []);

  const onPeriodChange = useCallback((next: string) => {
    if (!isValidPeriod(next)) return;
    autoRetryRef.current = false;
    setPeriod(next);
  }, []);

  return (
    <AuthGuard permission="dashboard.read">
      <AppShell title="Dashboard">
        <div className="page-grid">
          {/* M3-H2: period picker controls */}
          <section
            className="panel module-shell"
            style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}
          >
            <strong>Period:</strong>
            <span aria-live="polite">{formatPeriodLabel(period)}</span>
            <div role="group" aria-label="Preset periods" style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="button"
                onClick={() => onPeriodChange(currentPeriod())}
                aria-pressed={period === currentPeriod()}
              >
                This month
              </button>
              <button
                type="button"
                className="button"
                onClick={() => onPeriodChange(previousPeriod(currentPeriod()))}
                aria-pressed={period === previousPeriod(currentPeriod())}
              >
                Last month
              </button>
            </div>
            <label
              htmlFor="dashboard-period-custom"
              style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: "auto" }}
            >
              <span className="mini-muted">Custom:</span>
              <input
                id="dashboard-period-custom"
                type="month"
                value={period}
                onChange={(e) => onPeriodChange(e.target.value)}
                aria-label="Custom period (YYYY-MM)"
              />
            </label>
          </section>

          <section className="kpi-grid">
            <StatCard
              label="Total Patients"
              value={fmtCount(kpis?.patients_total)}
              detail="All records in CRM"
              loading={loading && !kpis}
            />
            <StatCard
              label="Active Patients"
              value={fmtCount(kpis?.patients_active)}
              detail="Currently active cases"
              loading={loading && !kpis}
            />
            {/* L2: was "Staff" — the field is `employees_*`. */}
            <StatCard
              label="Employees"
              value={fmtCount(kpis?.employees_total)}
              detail={fmtCount(kpis?.employees_active) + " active"}
              loading={loading && !kpis}
            />
            <StatCard
              label="Open Billings"
              value={fmtCount(kpis?.billings_open)}
              detail={fmtCount(kpis?.billings_total) + " total bills"}
              loading={loading && !kpis}
            />
            <StatCard
              label="Billing Collected"
              value={kpis ? formatCurrency(kpis.billing_collected_amount) : "—"}
              detail={"Pending " + (kpis ? formatCurrency(kpis.billing_pending_amount) : "—")}
              loading={loading && !kpis}
            />
            <StatCard
              label="Profit / Loss (cash)"
              value={kpis ? formatCurrency(kpis.profit_loss) : "—"}
              detail="Collected − payouts already paid"
              tooltip={
                "Cash-basis snapshot: receipts collected in the period minus payouts that have actually been disbursed. " +
                "Excludes payouts owed but not yet paid and partner-charge ledger. " +
                "Use the 'after pending payouts' card for the conservative (accrual) figure."
              }
              loading={loading && !kpis}
            />
            <StatCard
              label="P/L after pending payouts"
              value={kpis ? formatCurrency(kpis.profit_loss_after_pending) : "—"}
              detail="Collected − all payouts − partner charges"
              tooltip={
                "Accrual-basis profit: receipts collected minus the full net amount of every payout in the period " +
                "(paid or not) minus the partner-charge ledger. Matches the 'Net profit after pending payouts' figure " +
                "on the P/L report."
              }
              loading={loading && !kpis}
            />
            <StatCard
              label="Inquiries (month)"
              value={fmtCount(kpis?.inquiries_this_month)}
              detail="Created in selected period"
              loading={loading && !kpis}
            />
            <StatCard
              label="Duties completed"
              value={fmtCount(kpis?.duties_completed)}
              detail={
                fmtCount(kpis?.duties_scheduled) +
                " scheduled · " +
                fmtCount(kpis?.duties_active) +
                " active"
              }
              loading={loading && !kpis}
            />
          </section>

          {error ? (
            <section className="panel module-shell" role="alert" aria-live="assertive">
              <div className="error-text">{error}</div>
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="button primary"
                  onClick={onManualRetry}
                  disabled={loading}
                >
                  {loading ? "Retrying…" : "Retry"}
                </button>
              </div>
            </section>
          ) : null}

          {kpis && !loading && isEmptyPeriod(kpis) ? (
            <section className="panel module-shell">
              <div className="mini-muted">
                No activity recorded for {formatPeriodLabel(period)} yet. Switch the period
                above or come back after duties / billings have been recorded.
              </div>
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
                  KPIs scoped to <strong>{kpis?.period || period}</strong>
                  {kpis?.range
                    ? " (" + kpis.range.from.slice(0, 10) + " – " + kpis.range.to.slice(0, 10) + ")"
                    : ""}
                  .
                  {lastUpdated ? (
                    <>
                      <br />
                      <span>
                        Last updated{" "}
                        {lastUpdated.toLocaleTimeString("en-IN", {
                          hour: "2-digit",
                          minute: "2-digit"
                        })}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
