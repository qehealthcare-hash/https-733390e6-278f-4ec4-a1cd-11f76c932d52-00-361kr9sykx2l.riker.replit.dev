import type { ApiResult } from "@/types/common";
import { businessFailure, businessOk } from "@/business/businessResult";

export const DUTY_OVERLAP_SKIP_STATUSES = new Set(["CANCELLED", "NO_SHOW"]);

export interface DutyTimeSlot {
  id: string;
  employee_id?: string;
  start_at: string;
  end_at: string;
  status?: string;
}

/** True when two intervals overlap (exclusive end: startA < endB && endA > startB). */
export function dutiesTimeOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  return new Date(startA).getTime() < new Date(endB).getTime() && new Date(endA).getTime() > new Date(startB).getTime();
}

export function isOverlapExcludedStatus(status: string | undefined | null): boolean {
  return DUTY_OVERLAP_SKIP_STATUSES.has(String(status || "").toUpperCase());
}

export function shouldCheckDutyOverlap(status: string | undefined | null): boolean {
  return !isOverlapExcludedStatus(status);
}

/** First overlapping duty for same employee in a pre-fetched list. */
export function selectOverlappingDuty(
  duties: DutyTimeSlot[],
  employeeId: string,
  startAt: string,
  endAt: string,
  excludeId?: string
): DutyTimeSlot | null {
  return (
    duties.find(
      (d) =>
        d.employee_id === employeeId &&
        d.id !== excludeId &&
        !isOverlapExcludedStatus(d.status) &&
        dutiesTimeOverlap(startAt, endAt, d.start_at, d.end_at)
    ) || null
  );
}

export function canReopenCompletedDuty(currentStatus: string, nextStatus: string): ApiResult<null> {
  if (currentStatus === "COMPLETED" && nextStatus !== "COMPLETED") {
    return businessFailure("Completed duties cannot be reopened. Create a new duty instead.");
  }
  return businessOk();
}

export function canCancelDutyWithBilling(
  hasServiceLine: boolean,
  activeReceiptCount: number
): ApiResult<null> {
  if (hasServiceLine && activeReceiptCount > 0) {
    return businessFailure(
      "Cannot cancel — receipts have already been recorded against the bill from this duty",
      { activeReceiptCount }
    );
  }
  return businessOk();
}
