import type { ApiResult } from "@/types/common";
import { businessFailure, businessOk } from "@/business/businessResult";
import { clampMoneyNonNegative, roundMoney } from "@/utils/money";
import type { PayoutPermissionsDto } from "@/validation/payoutDto";
import type { PayoutStatus } from "@/validation/payoutValidation";
import { PAYOUT_CLOSED_STATUSES, PAYOUT_STATUSES } from "@/validation/payoutValidation";

export type { PayoutStatus };
export { PAYOUT_STATUSES, PAYOUT_CLOSED_STATUSES };

// ───────────────────────────────────────────────────────────────────────────
// Net amount math (single source of truth)
// ───────────────────────────────────────────────────────────────────────────

export interface PayoutAmounts {
  gross_amount?: number | string | null;
  advance?: number | string | null;
  deduction?: number | string | null;
  bonus?: number | string | null;
}

export function computePayoutNet(
  gross: number | string | null | undefined,
  advance: number | string | null | undefined,
  deduction: number | string | null | undefined,
  bonus: number | string | null | undefined
): number {
  const net =
    Number(gross || 0) +
    Number(bonus || 0) -
    Number(advance || 0) -
    Number(deduction || 0);
  // Net never negative — under-collection becomes a charge, not a refund.
  return clampMoneyNonNegative(net);
}

export interface MergedPayoutPatch {
  advance: number;
  deduction: number;
  bonus: number;
  remarks: string;
  net_amount: number;
}

export function mergePayoutAdjustments(
  existing: PayoutAmounts & { remarks?: string | null },
  input: Partial<PayoutAmounts> & { remarks?: string }
): MergedPayoutPatch {
  const advance = Number(input.advance ?? existing.advance ?? 0);
  const deduction = Number(input.deduction ?? existing.deduction ?? 0);
  const bonus = Number(input.bonus ?? existing.bonus ?? 0);
  const remarks = input.remarks ?? existing.remarks ?? "";
  const net_amount = computePayoutNet(existing.gross_amount, advance, deduction, bonus);
  return { advance, deduction, bonus, remarks, net_amount };
}

export function payoutOutstanding(netTotal: number, paidTotal: number): number {
  return Math.max(0, netTotal - paidTotal);
}

// ───────────────────────────────────────────────────────────────────────────
// Status guards
// ───────────────────────────────────────────────────────────────────────────

export function isPayoutLocked(status: string | null | undefined): boolean {
  return PAYOUT_CLOSED_STATUSES.has(String(status || "") as PayoutStatus);
}

export function isPayoutPaid(status: string | null | undefined): boolean {
  return String(status || "") === "PAID";
}

export function canEditPayout(status: string | null | undefined): ApiResult<null> {
  if (isPayoutPaid(status)) {
    return businessFailure("Cannot adjust a PAID payout", { status });
  }
  if (isPayoutLocked(status)) {
    return businessFailure("Payout is LOCKED — reopen before adjusting", { status });
  }
  return businessOk();
}

/** Legacy alias kept so existing imports continue to compile. */
export function canAdjustPayout(status: string | null | undefined): ApiResult<null> {
  return canEditPayout(status);
}

export function canMarkPayoutPaid(status: string | null | undefined): ApiResult<null> {
  if (isPayoutPaid(status)) {
    return businessFailure("Payout already paid", { status });
  }
  if (String(status || "") !== "LOCKED") {
    return businessFailure(
      "Payout must be LOCKED before marking paid — lock the period after review",
      { status }
    );
  }
  return businessOk();
}

/**
 * Advance disbursements (`tx_kind = 'ADVANCE'`) may only be issued while
 * the payout is still OPEN. Once it has been LOCKED the workflow is
 * "Reopen → adjust → Lock → Pay" — there is no legitimate reason to record
 * additional advances against a locked period.
 */
export function canPayAdvance(status: string | null | undefined): ApiResult<null> {
  if (isPayoutPaid(status)) {
    return businessFailure("Cannot pay advance against a PAID payout", { status });
  }
  if (String(status || "") === "LOCKED") {
    return businessFailure(
      "Cannot pay advance against a LOCKED payout — reopen, adjust, or settle in full",
      { status }
    );
  }
  return businessOk();
}

/**
 * Reject an advance / final disbursement that would over-pay the outstanding
 * balance for a payout. `paidSoFar` is the sum of prior `hh_paid_transactions`
 * rows for the payout; `netAmount` is the payout's current `net_amount`.
 *
 * Allows a small rounding tolerance so a final 99.99 + 0.01 cleanup row
 * doesn't fail at the boundary.
 */
export function ensureWithinPayoutOutstanding(
  netAmount: number,
  paidSoFar: number,
  newAmount: number
): ApiResult<null> {
  const remaining = Math.max(0, Number(netAmount || 0) - Number(paidSoFar || 0));
  if (Number(newAmount || 0) > remaining + 0.5) {
    return businessFailure(
      `Disbursement ₹${newAmount.toFixed(2)} exceeds remaining outstanding ₹${remaining.toFixed(2)}`,
      { net_amount: netAmount, paid_so_far: paidSoFar, attempted: newAmount, remaining }
    );
  }
  return businessOk();
}

/**
 * True when total disbursements settle (or over-settle within rounding) the
 * payout's net amount. The service uses this to auto-flip the payout's
 * status to PAID after a `FINAL` row is inserted.
 */
export function isPayoutFullyPaid(netAmount: number, paidSoFar: number): boolean {
  return Number(paidSoFar || 0) + 0.5 >= Number(netAmount || 0);
}

export function canLockPayout(
  status: string | null | undefined,
  netAmount: number,
  dutyCount: number
): ApiResult<null> {
  if (isPayoutPaid(status)) {
    return businessFailure("Cannot lock a PAID payout — it is already terminal", { status });
  }
  if (dutyCount === 0 && netAmount === 0) {
    return businessFailure("Cannot lock an empty payout — no duties / amount on file");
  }
  return businessOk();
}

export function canReopenPayout(status: string | null | undefined): ApiResult<null> {
  if (status !== "LOCKED") {
    return businessFailure(
      `Only LOCKED payouts can be reopened (current status: ${status || "unknown"})`,
      { status }
    );
  }
  return businessOk();
}

export interface BuildPayoutPermissionsInput {
  status: string | null | undefined;
  outstanding: number;
  netAmount: number;
  dutyCount: number;
}

/** Server-computed payout action flags for the React payouts UI. */
export function buildPayoutPermissions(
  input: BuildPayoutPermissionsInput
): PayoutPermissionsDto {
  const status = String(input.status || "OPEN");
  const blockReasons: Record<string, string> = {};

  const adjust = canEditPayout(status);
  if (!adjust.success) blockReasons.canAdjust = adjust.error || "Cannot adjust";

  const lock =
    status === "OPEN"
      ? canLockPayout(status, input.netAmount, input.dutyCount)
      : businessFailure(
          status === "LOCKED"
            ? "Payout is already LOCKED"
            : `Cannot lock payout in status ${status}`,
          { status }
        );
  if (!lock.success) blockReasons.canLock = lock.error || "Cannot lock";

  const reopen = canReopenPayout(status);
  if (!reopen.success) blockReasons.canReopen = reopen.error || "Cannot reopen";

  const payFinal = canMarkPayoutPaid(status);
  if (!payFinal.success) {
    blockReasons.canPayFinal = payFinal.error || "Cannot mark paid";
  } else if (Number(input.outstanding || 0) <= 0) {
    blockReasons.canPayFinal = "Nothing outstanding to disburse";
  }

  const payAdvance = canPayAdvance(status);
  if (!payAdvance.success) blockReasons.canPayAdvance = payAdvance.error || "Cannot pay advance";

  return {
    canAdjust: adjust.success,
    canLock: lock.success,
    canReopen: reopen.success,
    canPayFinal: payFinal.success && Number(input.outstanding || 0) > 0,
    canPayAdvance: payAdvance.success,
    blockReasons: Object.keys(blockReasons).length ? blockReasons : undefined
  };
}

export function canPayoutTransitionTo(
  current: string | null | undefined,
  next: PayoutStatus
): ApiResult<null> {
  const from = (String(current || "OPEN") as PayoutStatus);
  if (from === next) return businessOk();
  if (from === "PAID") {
    return businessFailure("PAID payouts are terminal — no further transitions allowed");
  }
  // OPEN → LOCKED → PAID, plus LOCKED → OPEN (reopen). Final pay requires LOCKED.
  const allowed: Record<PayoutStatus, PayoutStatus[]> = {
    OPEN: ["LOCKED"],
    LOCKED: ["OPEN", "PAID"],
    PAID: []
  };
  if (!allowed[from].includes(next)) {
    return businessFailure(`Illegal status transition ${from} → ${next}`);
  }
  return businessOk();
}

// ───────────────────────────────────────────────────────────────────────────
// Patches applied to hh_payouts
// ───────────────────────────────────────────────────────────────────────────

export function payoutLockRow(actorEmail: string, reason: string) {
  return {
    status: "LOCKED" as PayoutStatus,
    updated_by: actorEmail,
    remarks: reason || undefined
  };
}

export function payoutReopenRow(actorEmail: string, reason: string) {
  return {
    status: "OPEN" as PayoutStatus,
    updated_by: actorEmail,
    remarks: reason
  };
}

export function payoutPaidRow(actorEmail: string, paidOnISO: string) {
  return {
    status: "PAID" as PayoutStatus,
    paid_at: paidOnISO,
    updated_by: actorEmail
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Per-patient breakdown + duty/attendance sync helpers
// ───────────────────────────────────────────────────────────────────────────

export interface DutyForPayout {
  id?: string;
  patient_id?: string | null;
  employee_id?: string | null;
  start_at?: string | null;
  shift_type?: string | null;
  status?: string | null;
}

export interface AttendanceForPayout {
  duty_id?: string | null;
  employee_id?: string | null;
  hours?: number | string | null;
  status?: string | null;
  check_in_at?: string | null;
}

export interface PayoutPatientBreakdownRow {
  patient_id: string;
  duty_count: number;
  hours: number;
  duty_ids: string[];
}

/** Attendance statuses that count as a payable work day (shared with payoutService). */
export const PAYABLE_ATTENDANCE_STATUSES = new Set([
  "PRESENT",
  "LATE",
  "HALF_DAY"
]);

/**
 * @deprecated Duty-calendar SSOT: use charge-based `buildPatientBreakdown` in
 * payoutService instead. This attendance-based helper is retained only so
 * legacy imports compile; it always returns an empty breakdown.
 */
export function breakdownByPatient(
  _duties: DutyForPayout[],
  _attendance: AttendanceForPayout[]
): PayoutPatientBreakdownRow[] {
  return [];
}

export interface PayoutTotals {
  gross_amount: number;
  bonus: number;
  advance: number;
  deduction: number;
  net_amount: number;
  duty_count: number;
  hours: number;
}

export function emptyPayoutTotals(): PayoutTotals {
  return {
    gross_amount: 0,
    bonus: 0,
    advance: 0,
    deduction: 0,
    net_amount: 0,
    duty_count: 0,
    hours: 0
  };
}

/** Aggregate payout rows for a period — dashboard parity helper. */
export function sumPayoutTotals(rows: Array<Record<string, unknown>>): PayoutTotals {
  const t = emptyPayoutTotals();
  for (const r of rows) {
    t.gross_amount += Number(r.gross_amount || 0);
    t.bonus += Number(r.bonus || 0);
    t.advance += Number(r.advance || 0);
    t.deduction += Number(r.deduction || 0);
    t.net_amount += Number(r.net_amount || 0);
    t.duty_count += Number(r.duty_count || 0);
    t.hours += Number(r.hours || 0);
  }
  // Round to 2dp.
  for (const k of Object.keys(t) as (keyof PayoutTotals)[]) {
    t[k] = roundMoney(t[k]);
  }
  return t;
}

// ───────────────────────────────────────────────────────────────────────────
// Sanity guards
// ───────────────────────────────────────────────────────────────────────────

/**
 * Reject obvious calculation mistakes before they reach the DB:
 *   - negative advance/deduction/bonus (Zod also rejects, but defence in depth)
 *   - advance + deduction > gross + bonus (would compute net < 0 → clamped, but
 *     surface the warning so accountant can correct)
 */
export function validatePayoutAmounts(
  gross: number,
  advance: number,
  deduction: number,
  bonus: number
): ApiResult<null> {
  if (advance < 0 || deduction < 0 || bonus < 0) {
    return businessFailure("Advance / deduction / bonus must be non-negative");
  }
  if (advance + deduction > gross + bonus + 0.01) {
    return businessFailure(
      "Advance + deduction exceeds gross + bonus — payout would be zero. Confirm before proceeding.",
      { gross, advance, deduction, bonus }
    );
  }
  return businessOk();
}

/** Throws if the source duty/attendance data is empty when the user expects a payout. */
export function ensurePayoutHasSource(dutyCount: number, hours: number): ApiResult<null> {
  if (dutyCount === 0 && hours === 0) {
    return businessFailure(
      "No duty / attendance records for this employee in the selected period — nothing to bill"
    );
  }
  return businessOk();
}
