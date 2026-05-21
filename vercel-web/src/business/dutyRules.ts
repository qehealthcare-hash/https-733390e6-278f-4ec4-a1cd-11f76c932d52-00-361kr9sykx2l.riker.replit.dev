import type { ApiResult } from "@/types/common";
import { businessFailure, businessOk } from "@/business/businessResult";
import type { DutyShiftType, DutyStatus } from "@/validation/dutyValidation";
import { DUTY_SHIFT_TYPES } from "@/validation/dutyValidation";

export { DUTY_SHIFT_TYPES };
export type { DutyShiftType, DutyStatus };

/** Statuses that should be skipped when checking for overlap. */
export const DUTY_OVERLAP_SKIP_STATUSES = new Set<DutyStatus>(["CANCELLED", "NO_SHOW"]);

export interface DutyTimeSlot {
  id: string;
  employee_id?: string | null;
  patient_id?: string | null;
  start_at: string;
  end_at: string;
  status?: string | null;
}

/** True when two intervals overlap (start exclusive end). */
export function dutiesTimeOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  return (
    new Date(startA).getTime() < new Date(endB).getTime() &&
    new Date(endA).getTime() > new Date(startB).getTime()
  );
}

export function isOverlapExcludedStatus(status: string | undefined | null): boolean {
  return DUTY_OVERLAP_SKIP_STATUSES.has(String(status || "").toUpperCase() as DutyStatus);
}

/**
 * When updating a duty we only need to re-validate overlap if the new status
 * is still effective (anything that isn't CANCELLED / NO_SHOW).
 */
export function shouldCheckDutyOverlap(status: string | undefined | null): boolean {
  return !isOverlapExcludedStatus(status);
}

function selectOverlap(
  duties: DutyTimeSlot[],
  startAt: string,
  endAt: string,
  matcher: (d: DutyTimeSlot) => boolean,
  excludeId?: string
): DutyTimeSlot | null {
  return (
    duties.find(
      (d) =>
        d.id !== excludeId &&
        !isOverlapExcludedStatus(d.status) &&
        matcher(d) &&
        dutiesTimeOverlap(startAt, endAt, d.start_at, d.end_at)
    ) || null
  );
}

/** First overlapping duty for the same employee from a pre-fetched candidate list. */
export function selectOverlappingDuty(
  duties: DutyTimeSlot[],
  employeeId: string,
  startAt: string,
  endAt: string,
  excludeId?: string
): DutyTimeSlot | null {
  return selectOverlap(duties, startAt, endAt, (d) => d.employee_id === employeeId, excludeId);
}

/** First overlapping duty for the same patient from a pre-fetched candidate list. */
export function selectPatientOverlappingDuty(
  duties: DutyTimeSlot[],
  patientId: string,
  startAt: string,
  endAt: string,
  excludeId?: string
): DutyTimeSlot | null {
  return selectOverlap(duties, startAt, endAt, (d) => d.patient_id === patientId, excludeId);
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

/** Patch applied to `hh_duties` when a duty is cancelled. */
export function dutyCancellationPatch(actorEmail: string, reason: string) {
  return {
    status: "CANCELLED" as DutyStatus,
    cancel_reason: reason || "",
    updated_by: actorEmail
  };
}

/** Patch applied when transitioning to IN_PROGRESS on check-in. */
export function dutyCheckInPatch(actorEmail: string) {
  return {
    status: "IN_PROGRESS" as DutyStatus,
    updated_by: actorEmail
  };
}

/** Patch applied when transitioning to COMPLETED on check-out. */
export function dutyCheckOutPatch(actorEmail: string) {
  return {
    status: "COMPLETED" as DutyStatus,
    updated_by: actorEmail
  };
}

/**
 * Payout period for a duty is the YYYY-MM of its scheduled start (M3 rule:
 * "aggregate by the duty's own month, not the checkout date").
 */
export function payoutPeriodForDuty(dutyStartAt: string, fallbackTimestamp: string): string {
  return (dutyStartAt || fallbackTimestamp).slice(0, 7);
}

/** Compute the shift's default end timestamp from start + shift type. */
export function defaultEndForShift(startAt: string, shift: DutyShiftType): string {
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) return startAt;
  const hours = shift === "24H" || shift === "FULL" ? 24 : shift === "NIGHT" ? 12 : 10;
  return new Date(start.getTime() + hours * 3_600_000).toISOString();
}

/** Build the JSON-row patch used when persisting a Duty via the repository. */
export function dutyPersistRow(input: {
  id: string;
  patient_id: string;
  employee_id: string;
  service_type?: string;
  shift_type: DutyShiftType;
  start_at: string;
  end_at: string;
  status: DutyStatus;
  cancel_reason?: string;
  notes?: string;
  billing_id?: string | null;
}) {
  return {
    id: input.id,
    patient_id: input.patient_id,
    employee_id: input.employee_id,
    service_type: input.service_type ?? "",
    shift_type: input.shift_type,
    start_at: input.start_at,
    end_at: input.end_at,
    status: input.status,
    cancel_reason: input.cancel_reason ?? "",
    notes: input.notes ?? "",
    billing_id: input.billing_id ?? null
  };
}
