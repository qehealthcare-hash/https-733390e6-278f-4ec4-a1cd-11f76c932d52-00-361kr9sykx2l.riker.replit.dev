import { crmDateKeyFromTimestamp } from "@/utils/crmToday";

export interface MonthRange {
  period: string;
  startISO: string;
  endISO: string;
}

/** Build YYYY-MM month window in UTC. */
export function monthRangeUTC(month?: string): MonthRange {
  const m = (month || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(m)) {
    const now = new Date();
    const y = now.getUTCFullYear();
    const mo = String(now.getUTCMonth() + 1).padStart(2, "0");
    return monthRangeUTC(`${y}-${mo}`);
  }
  const [y = 0, mo = 1] = m.split("-").map((n) => parseInt(n, 10));
  const start = new Date(Date.UTC(y, mo - 1, 1));
  const end = new Date(Date.UTC(y, mo, 1));
  return { period: m, startISO: start.toISOString(), endISO: end.toISOString() };
}

/**
 * Payout period (YYYY-MM) for a duty/attendance/check-in timestamp,
 * computed in the CRM (IST) timezone — NOT UTC. The previous form
 * `iso.slice(0, 7)` returned the UTC month, which split duties at IST
 * month boundaries: e.g. a duty whose start_at was `2026-04-30T18:30:00Z`
 * (00:00 IST May 1) reported "2026-04" and recomputed the wrong
 * payslip / left May payouts stale. Returns "" if the input is empty
 * or unparseable so callers can chain to fallbacks.
 */
export function payoutPeriodFromTimestamp(iso: string | undefined | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return crmDateKeyFromTimestamp(iso).slice(0, 7);
}
