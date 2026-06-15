import type { ApiResult } from "@/types/common";
import { businessFailure } from "@/business/businessResult";

/** User-facing message when a non–Duty Calendar module tries to mutate duty-derived data. */
export const DUTY_CALENDAR_SOT_MESSAGE =
  "Duty Calendar is the single source of truth. Edit duty days, charges, and payouts only from the Duty Calendar.";

export const DUTY_CALENDAR_ATTENDANCE_SOT_MESSAGE =
  "Attendance is derived from the Duty Calendar. Use Check-in / Check-out on the duty, not manual attendance marks.";

export const DUTY_CALENDAR_BILLING_GENERATE_DISABLED_MESSAGE =
  "Bill generation from duties is disabled. Open the Duty Calendar, save the duty with materialize enabled, then sync the billing ledger.";

export const DUTY_CALENDAR_LEDGER_REPLACE_DISABLED_MESSAGE =
  "Manual billing/payout ledger replace is disabled. Edit charges and payouts in the Duty Calendar.";

export function dutyCalendarSotFailure(
  message: string = DUTY_CALENDAR_SOT_MESSAGE
): ApiResult<never> {
  return businessFailure(message);
}
