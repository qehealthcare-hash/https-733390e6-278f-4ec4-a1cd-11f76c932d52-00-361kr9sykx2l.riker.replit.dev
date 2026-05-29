/**
 * Period helpers for the CRM. (M3-H3)
 *
 * The CRM operates in IST. Previously, `app/dashboard/page.js` computed
 * `currentPeriod()` from `new Date().getMonth()` — i.e. the local
 * timezone month — while several server-side helpers fall back to
 * `monthRangeUTC()` when no period is supplied. The two clocks tick the
 * same second but disagree about the calendar month for ~5h30 around
 * IST midnight on the 1st of each month, producing a silent
 * wrong-month bug ("dashboard shows May data on June 1 morning").
 *
 * Fix:
 *   1. Always compute the period STRING in the app's business timezone
 *      (`APP_TIMEZONE = "Asia/Kolkata"`).
 *   2. Send that explicit period string to the API so the server uses
 *      it instead of its own UTC fallback. Server still windows the
 *      month using `monthRangeUTC`, but that's now consistent because
 *      the frontend dictates the period exactly.
 *
 * Pure module: zero dependencies, safe to import from server and
 * client. Tested in `lib/__tests__/period.test.ts`.
 */

/** Canonical business timezone (IANA name). */
export const APP_TIMEZONE = "Asia/Kolkata";

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * Format a `Date` as a `YYYY-MM` period string in the given timezone.
 * Defaults to the app timezone (IST) so the dashboard agrees with the
 * operator's wall clock.
 */
export function periodForDate(date: Date, timeZone: string = APP_TIMEZONE): string {
  // `en-CA` lays out date parts as YYYY-MM-DD, which we slice to YYYY-MM.
  // Using `formatToParts` would also work; the slice is just simpler.
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit"
  }).format(date);
  // Some Node ICU builds emit a `\u200E` LTR mark between fields; strip it.
  return formatted.replace(/[^\d-]/g, "").slice(0, 7);
}

/** Returns the current period (`YYYY-MM`) in the given timezone. */
export function currentPeriod(timeZone: string = APP_TIMEZONE): string {
  return periodForDate(new Date(), timeZone);
}

/**
 * Returns the period that came before `period`. Wraps year boundaries
 * (e.g. `previousPeriod("2026-01")` → `"2025-12"`). Falls back to the
 * current period on invalid input rather than throwing — callers
 * passing user input shouldn't have to wrap with try/catch.
 */
export function previousPeriod(period: string, timeZone: string = APP_TIMEZONE): string {
  const m = PERIOD_RE.exec(period);
  if (!m) return currentPeriod(timeZone);
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  if (mo === 1) return `${y - 1}-12`;
  return `${y}-${String(mo - 1).padStart(2, "0")}`;
}

/** Returns true if `s` is a valid `YYYY-MM` period string. */
export function isValidPeriod(s: unknown): s is string {
  return typeof s === "string" && PERIOD_RE.test(s);
}

/**
 * Human-readable label for a period (e.g. "May 2026").
 * Uses `en-IN` so month names match the rest of the CRM.
 */
export function formatPeriodLabel(period: string): string {
  const m = PERIOD_RE.exec(period);
  if (!m) return period;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  // Day-1 noon avoids any half-day timezone weirdness in `toLocaleString`.
  const date = new Date(Date.UTC(y, mo - 1, 1, 12, 0, 0));
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    year: "numeric",
    month: "long"
  }).format(date);
}
