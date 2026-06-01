import type { ApiResult } from "@/types/common";
import { businessFailure, businessOk } from "@/business/businessResult";
import type { DutyShiftType, DutyStatus } from "@/validation/dutyValidation";
import { DUTY_SHIFT_TYPES } from "@/validation/dutyValidation";
import type { DutyPermissionsDto } from "@/validation/dutyDto";
import { crmDateKeyFromTimestamp } from "@/utils/crmToday";

export { DUTY_SHIFT_TYPES };
export type { DutyShiftType, DutyStatus };

/** Statuses that should be skipped when checking for overlap. */
export const DUTY_OVERLAP_SKIP_STATUSES = new Set<DutyStatus>(["CANCELLED", "NO_SHOW"]);

/**
 * Sentinel `end_at` stored when a duty is "open-ended" — the legacy CRM had
 * no way to express "runs until the bill closes", and the production `hh_duties`
 * table requires a non-null end_at. We pick a far-future timestamp so that:
 *   - The DB unique / overlap indexes still work
 *   - The materializer can detect open-ended duties via {@link isOpenEndedEndAt}
 *   - Closing the bill rewrites this to the actual close date
 */
export const OPEN_ENDED_END_AT = "2099-12-31T23:59:59.000Z";

/** Match the sentinel even if persisted with a different time component. */
export function isOpenEndedEndAt(endAt: string | null | undefined): boolean {
  if (!endAt) return true;
  return String(endAt).slice(0, 10) === "2099-12-31";
}

/** Pick a sentinel that's safely after `start_at`. */
export function openEndedSentinelFor(_startAt: string): string {
  return OPEN_ENDED_END_AT;
}

/**
 * The date through which the materializer should expand a duty into per-day
 * diary rows. For an open-ended duty this is "today"; once a closing date
 * (bill close or explicit end_at) is set, it caps to whichever is earlier.
 *
 * `nowIso` is injected for deterministic tests.
 *
 * Note on comparisons: we compare ISO timestamps via `Date.parse` so a `Z`
 * suffix vs `+05:30` offset doesn't trip the lexical ordering. Before this
 * fix, comparing `"2026-05-29T20:00:00Z"` (≈01:30 IST May 30) with
 * `"2026-05-29T23:59:59.999+05:30"` (today's IST end) made the Z-suffixed
 * value look "earlier" alphabetically, so the materializer extended past
 * today and seeded phantom diary rows that billing/payout then had to
 * dedup. Fixing the comparison keeps duty calendar ↔ billing/payout
 * boundaries aligned to the same instant in time.
 */
export function effectiveMaterializeEndAt(
  duty: { end_at?: string | null },
  billClosedAt: string | null | undefined,
  nowIso: string
): string {
  const today = nowIso;
  const todayMs = Date.parse(today);
  let candidate = today;
  let candidateMs = todayMs;
  if (duty.end_at && !isOpenEndedEndAt(duty.end_at)) {
    const endMs = Date.parse(duty.end_at);
    if (Number.isFinite(endMs) && endMs < todayMs) {
      candidate = duty.end_at;
      candidateMs = endMs;
    }
  }
  if (billClosedAt) {
    const closedMs = Date.parse(billClosedAt);
    if (Number.isFinite(closedMs) && closedMs < candidateMs) {
      candidate = billClosedAt;
      candidateMs = closedMs;
    }
  }
  return candidate;
}

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

/**
 * Block direct status edits that bypass check-in/out workflow on the form.
 *
 * Allowed shape transitions (other status changes happen via the dedicated
 * check-in / check-out / cancel endpoints):
 *   SCHEDULED → SCHEDULED | CANCELLED                 (edit/cancel)
 *   IN_PROGRESS → IN_PROGRESS                         (edit only)
 *   COMPLETED → COMPLETED                             (no edits; see above)
 *   CANCELLED → CANCELLED                             (terminal)
 *   NO_SHOW   → NO_SHOW | SCHEDULED                   (admin re-schedule)
 */
export function canEditDutyStatus(currentStatus: string, nextStatus: string): ApiResult<null> {
  if (currentStatus === nextStatus) return businessOk();
  // Anyone can flip a SCHEDULED duty to CANCELLED via the form.
  if (currentStatus === "SCHEDULED" && nextStatus === "CANCELLED") return businessOk();
  // Admin re-opening a no-show.
  if (currentStatus === "NO_SHOW" && nextStatus === "SCHEDULED") return businessOk();
  return businessFailure(
    `Status transition ${currentStatus} → ${nextStatus} is not allowed from the duty form. ` +
      `Use the Check-in / Check-out / Cancel actions instead.`,
    { currentStatus, nextStatus }
  );
}

export interface BuildDutyPermissionsInput {
  status: string | null | undefined;
  hasActiveReceiptOnBilling?: boolean;
  hasBillingServiceLine?: boolean;
  hasCheckIn?: boolean;
}

/**
 * Server-computed duty action flags for the React duty calendar / drawer.
 *
 * Pure: depends only on the duty's own state + a couple of pre-fetched
 * counts from the parent billing. RBAC is enforced at the API edge via
 * `requireRole`; this function is about *state-machine* truth.
 */
export function buildDutyPermissions(
  input: BuildDutyPermissionsInput
): DutyPermissionsDto {
  const status = String(input.status || "SCHEDULED").toUpperCase();
  const blockReasons: Record<string, string> = {};

  // Editing the duty form — anything except CANCELLED / COMPLETED is editable.
  let canEdit = true;
  if (status === "COMPLETED") {
    canEdit = false;
    blockReasons.canEdit = "Completed duties cannot be edited";
  } else if (status === "CANCELLED") {
    canEdit = false;
    blockReasons.canEdit = "Cancelled duties cannot be edited";
  }

  const cancelStateOk = canCancelDuty(status);
  let canCancel = cancelStateOk.success;
  if (!cancelStateOk.success) {
    blockReasons.canCancel = cancelStateOk.error || "Cannot cancel";
  } else if (input.hasBillingServiceLine && (input.hasActiveReceiptOnBilling ?? false)) {
    canCancel = false;
    blockReasons.canCancel =
      "Cannot cancel — receipts have already been recorded against the bill from this duty";
  }

  // Check-in only meaningful for SCHEDULED; check-out only for IN_PROGRESS
  // duties that already have an attendance row (hasCheckIn flag).
  const canCheckIn = status === "SCHEDULED";
  if (!canCheckIn) {
    blockReasons.canCheckIn =
      status === "IN_PROGRESS"
        ? "Duty is already in progress"
        : status === "COMPLETED"
          ? "Duty is already complete"
          : `Cannot check in from status ${status}`;
  }

  const canCheckOut = status === "IN_PROGRESS" && (input.hasCheckIn ?? true);
  if (!canCheckOut) {
    blockReasons.canCheckOut =
      status !== "IN_PROGRESS"
        ? `Cannot check out from status ${status}`
        : "Missing check-in record";
  }

  // Materialize (expand diary rows) makes sense while a duty is active.
  const canMaterialize = status === "SCHEDULED" || status === "IN_PROGRESS";
  if (!canMaterialize) {
    blockReasons.canMaterialize = `Cannot materialize a ${status} duty`;
  }

  // Hard delete is always state-allowed (admin-only at RBAC layer); the UI
  // still gates the button by role. Flag exists for completeness.
  const canHardDelete = true;

  return {
    canEdit,
    canCancel,
    canCheckIn,
    canCheckOut,
    canMaterialize,
    canHardDelete,
    blockReasons: Object.keys(blockReasons).length ? blockReasons : undefined
  };
}

/** Dedicated cancel endpoint — COMPLETED duties are terminal. */
export function canCancelDuty(currentStatus: string): ApiResult<null> {
  const s = String(currentStatus || "").toUpperCase();
  if (s === "COMPLETED") {
    return businessFailure(
      "Completed duties cannot be cancelled. Create a new duty instead."
    );
  }
  if (s === "CANCELLED") {
    return businessFailure("Duty is already cancelled.");
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
 * Payout period for a duty is the YYYY-MM of its scheduled start in the
 * CRM (IST) timezone (M3 rule: "aggregate by the duty's own month, not
 * the checkout date").
 *
 * Date-format fix: the previous form `iso.slice(0, 7)` returned the UTC
 * month, so a duty starting at `2026-04-30T18:30:00Z` (= 00:00 IST May 1)
 * was billed in May (per `eachDutyCalendarDay`'s IST window) but recompute
 * was triggered for "2026-04". The April payslip got rebuilt while May —
 * the actual payout month — went stale. Now we always derive the period
 * from the IST calendar day, matching the diary/billing/payout windows.
 */
export function payoutPeriodForDuty(dutyStartAt: string, fallbackTimestamp: string): string {
  const source = dutyStartAt || fallbackTimestamp;
  if (!source) return "";
  const d = new Date(source);
  if (Number.isNaN(d.getTime())) {
    return String(source).slice(0, 7);
  }
  return crmDateKeyFromTimestamp(source).slice(0, 7);
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
  service_name?: string;
  shift_type: DutyShiftType;
  start_at: string;
  end_at?: string;
  status: DutyStatus;
  cancel_reason?: string;
  notes?: string;
  billing_id?: string | null;
  charge_per_day?: number;
  payout_per_day?: number;
  payout_term?: string;
  extra_partners?: unknown;
}) {
  const rawName =
    (input.service_name || "").trim() || (input.service_type || "").trim() || "Care Taker Services";
  const serviceName = rawName.replace(/\s+/g, " ").trim();
  return {
    id: input.id,
    patient_id: input.patient_id,
    employee_id: input.employee_id,
    service_type: input.service_type ?? serviceName,
    service_name: serviceName,
    shift_type: input.shift_type,
    start_at: input.start_at,
    end_at: input.end_at || openEndedSentinelFor(input.start_at),
    status: input.status,
    cancel_reason: input.cancel_reason ?? "",
    notes: input.notes ?? "",
    billing_id: input.billing_id ?? null,
    charge_per_day: Number(input.charge_per_day ?? 0),
    payout_per_day: Number(input.payout_per_day ?? 0),
    payout_term: input.payout_term ?? "Daily",
    extra_partners: input.extra_partners ?? []
  };
}
