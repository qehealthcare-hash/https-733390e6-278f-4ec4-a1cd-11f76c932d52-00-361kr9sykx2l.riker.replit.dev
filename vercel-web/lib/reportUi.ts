/**
 * Reports module UI helpers (M10 Pass D).
 *
 * Pure period/presentation utilities — no API calls.
 */

import { crmTodayIso } from "@/src/utils/crmToday";

/** Current payout/billing report period (YYYY-MM) in IST. */
export function currentPeriod(): string {
  return crmTodayIso().slice(0, 7);
}

/** Normalize `<input type="month">` value to YYYY-MM. */
export function periodFromMonthInput(monthValue: string | undefined | null): string {
  if (monthValue && /^\d{4}-\d{2}$/.test(monthValue)) return monthValue;
  return currentPeriod();
}

export function reportTabClass(active: boolean): string {
  return "button " + (active ? "primary" : "secondary");
}
