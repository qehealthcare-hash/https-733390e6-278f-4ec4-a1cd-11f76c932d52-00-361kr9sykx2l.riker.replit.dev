/**
 * Shared Duty Calendar read-only + desync UI helpers.
 *
 * Used by Billing, Payout, and Attendance screens so every module shows the
 * same message and applies the same desync rule before payment actions.
 */

/** Shown on every read-only duty-derived panel. */
export const DUTY_LEDGER_READONLY_MESSAGE =
  "This data is auto-calculated from Duty Calendar. To modify, edit the Duty Calendar entry.";

/** Red alert headline when cached totals disagree with the live duty ledger. */
export const DESYNC_ALERT_HEADLINE =
  "DESYNC DETECTED — DATA MUST BE RECOMPUTED FROM DUTY CALENDAR";

/**
 * True when a non-frozen module aggregate disagrees with the live duty ledger.
 * Payment / lock actions must be blocked until a recompute reconciles the cache.
 */
export function detectLedgerDesync(args: {
  liveAmount: number;
  cachedAmount: number;
  liveCount: number;
  cachedCount: number;
  comparable: boolean;
  /** When true (e.g. PAID payout), never flag — the period is a frozen snapshot. */
  frozen?: boolean;
}): boolean {
  if (!args.comparable) return false;
  if (args.frozen) return false;
  return (
    Math.round(args.liveAmount) !== Math.round(args.cachedAmount) ||
    Number(args.liveCount) !== Number(args.cachedCount)
  );
}
