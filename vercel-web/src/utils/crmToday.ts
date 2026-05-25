/** Business calendar day in Asia/Kolkata (Hominal CRM default). */
export const CRM_TIMEZONE = "Asia/Kolkata";

/** YYYY-MM-DD in the CRM timezone (e.g. IST). */
export function crmTodayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CRM_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

/** End-of CRM calendar day as an ISO string used by materialize clipping. */
export function crmTodayEndIso(now: Date = new Date()): string {
  return `${crmTodayIso(now)}T23:59:59.999Z`;
}

/** Start of a CRM calendar day as ISO (IST offset). */
export function crmDayStartIso(dateKey: string): string {
  return `${dateKey}T00:00:00.000+05:30`;
}

/** End of a CRM calendar day as ISO (IST offset). */
export function crmDayEndIso(dateKey: string): string {
  return `${dateKey}T23:59:59.999+05:30`;
}

/** YYYY-MM-DD in CRM timezone from an ISO timestamp. */
export function crmDateKeyFromTimestamp(
  iso: string | undefined | null,
  fallback?: string
): string {
  if (!iso) return fallback || crmTodayIso();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback || crmTodayIso();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CRM_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(d);
}

/** Add one calendar day to YYYY-MM-DD (UTC-safe for CRM keys). */
export function crmAddDaysIso(dateKey: string, days: number): string {
  const base = new Date(`${dateKey}T12:00:00+05:30`);
  base.setDate(base.getDate() + days);
  return crmDateKeyFromTimestamp(base.toISOString());
}

/** Every YYYY-MM-DD from `from` through `to` inclusive. */
export function crmDateRangeInclusive(from: string, to: string): string[] {
  if (from > to) return [];
  const out: string[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    if (cur === to) break;
    cur = crmAddDaysIso(cur, 1);
  }
  return out;
}
