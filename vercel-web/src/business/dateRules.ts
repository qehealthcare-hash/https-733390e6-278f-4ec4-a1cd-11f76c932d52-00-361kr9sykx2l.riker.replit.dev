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
  const [y, mo] = m.split("-").map((n) => parseInt(n, 10));
  const start = new Date(Date.UTC(y, mo - 1, 1));
  const end = new Date(Date.UTC(y, mo, 1));
  return { period: m, startISO: start.toISOString(), endISO: end.toISOString() };
}

/** Payout period from duty start (M3: not checkout date). */
export function payoutPeriodFromTimestamp(iso: string | undefined | null): string {
  return (iso || "").slice(0, 7);
}
