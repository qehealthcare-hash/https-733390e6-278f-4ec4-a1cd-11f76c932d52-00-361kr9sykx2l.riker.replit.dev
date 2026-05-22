import type { ApiResult } from "@/types/common";
import { businessFailure, businessOk } from "@/business/businessResult";
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
  return Math.round(Math.max(net, 0) * 100) / 100;
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
  return businessOk();
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

export function canPayoutTransitionTo(
  current: string | null | undefined,
  next: PayoutStatus
): ApiResult<null> {
  const from = (String(current || "OPEN") as PayoutStatus);
  if (from === next) return businessOk();
  if (from === "PAID") {
    return businessFailure("PAID payouts are terminal — no further transitions allowed");
  }
  // OPEN → LOCKED → PAID, plus LOCKED → OPEN (reopen). LOCKED → PAID OK.
  const allowed: Record<PayoutStatus, PayoutStatus[]> = {
    OPEN: ["LOCKED", "PAID"],
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

/**
 * Aggregate the duties + attendance for an employee + period into a per-patient
 * breakdown. Used by the UI to show "this payout came from these patients" so
 * accountants can answer parent questions about which contract earned what.
 */
export function breakdownByPatient(
  duties: DutyForPayout[],
  attendance: AttendanceForPayout[]
): PayoutPatientBreakdownRow[] {
  const attendanceByDuty = new Map<string, AttendanceForPayout>();
  for (const a of attendance) {
    const dutyId = String(a.duty_id || "");
    if (!dutyId) continue;
    attendanceByDuty.set(dutyId, a);
  }
  const map = new Map<string, PayoutPatientBreakdownRow>();
  for (const d of duties) {
    const patientId = String(d.patient_id || "");
    if (!patientId) continue;
    const status = String(d.status || "").toUpperCase();
    if (status === "CANCELLED" || status === "NO_SHOW") continue;
    const att = d.id ? attendanceByDuty.get(String(d.id)) : undefined;
    const present = String(att?.status || "").toUpperCase() === "PRESENT";
    const hours = Number(att?.hours || 0);

    const row = map.get(patientId) || {
      patient_id: patientId,
      duty_count: 0,
      hours: 0,
      duty_ids: []
    };
    if (present) {
      row.duty_count += 1;
      row.hours += hours;
    }
    if (d.id) row.duty_ids.push(String(d.id));
    map.set(patientId, row);
  }
  return Array.from(map.values()).sort((a, b) => b.duty_count - a.duty_count);
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
    t[k] = Math.round(Number(t[k]) * 100) / 100;
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
