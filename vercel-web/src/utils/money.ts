/** INR ledger scale — all monetary totals round to 2 decimal places. */
const MONEY_SCALE = 100;

/** Coerce unknown input to a finite number (non-finite → 0). */
export function moneyNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Round to 2 decimal places (half-up). */
export function roundMoney(value: unknown): number {
  return Math.round(moneyNumber(value) * MONEY_SCALE) / MONEY_SCALE;
}

/** Alias for `roundMoney` — parse string/number inputs from forms or DB. */
export function parseMoney(value: unknown): number {
  return roundMoney(value);
}

/** Sum monetary values, rounding once at the end to avoid float drift. */
export function sumMoney(values: Iterable<unknown>): number {
  let total = 0;
  for (const value of values) {
    total += moneyNumber(value);
  }
  return roundMoney(total);
}

/** Round and clamp to non-negative (net payout, outstanding, etc.). */
export function clampMoneyNonNegative(value: unknown): number {
  return roundMoney(Math.max(0, moneyNumber(value)));
}

/** Billed minus received, never negative, rounded to 2dp. */
export function moneyOutstanding(billed: unknown, received: unknown): number {
  return clampMoneyNonNegative(moneyNumber(billed) - moneyNumber(received));
}
