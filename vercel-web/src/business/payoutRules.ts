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
  /** Hydrated by the service (left empty by this pure function). */
  patient_name: string;
  duty_count: number;
  hours: number;
  /** ₹ earned from this patient's duties this period (from hh_payout_charges). */
  amount: number;
  /** Distinct YYYY-MM-DD days the employee was assigned to this patient. */
  dates: string[];
  duty_ids: string[];
}

/**
 * Minimal shape required from a hh_payout_charges row to attribute its
 * amount to a patient. We only need the remarks (which encode `duty:<id>:…`)
 * and the amount; everything else is ignored.
 */
export interface ChargeForPayout {
  remarks?: string | null;
  amount?: number | string | null;
  date?: string | null;
}

const DIARY_REMARKS_RE = /^duty:([^:]+):(\d{4}-\d{2}-\d{2})/;

function parseDutyIdFromRemarks(remarks: string | null | undefined): {
  dutyId: string;
  isoDate: string;
} | null {
  if (!remarks) return null;
  const match = DIARY_REMARKS_RE.exec(String(remarks));
  if (!match) return null;
  return { dutyId: match[1], isoDate: match[2] };
}

/**
 * Aggregate the duties + attendance + materialized charges for an employee +
 * period into a per-patient breakdown. Used by the UI / PDFs / receipts to
 * show "this payout came from these patients" so accountants can answer
 * parent questions about which contract earned what.
 *
 * - `duty_count` and `hours` come from attendance (PRESENT-only).
 * - `amount` and `dates` come from hh_payout_charges (the same source that
 *   feeds Gross), attributed to a patient via duty_id in the charge remarks.
 *   This way the per-patient totals always sum to Gross.
 * - `patient_name` is left blank for the service layer to hydrate.
 */
export function breakdownByPatient(
  duties: DutyForPayout[],
  attendance: AttendanceForPayout[],
  charges: ChargeForPayout[] = []
): PayoutPatientBreakdownRow[] {
  const attendanceByDuty = new Map<string, AttendanceForPayout>();
  for (const a of attendance) {
    const dutyId = String(a.duty_id || "");
    if (!dutyId) continue;
    attendanceByDuty.set(dutyId, a);
  }
  const dutyToPatient = new Map<string, string>();
  for (const d of duties) {
    if (d.id && d.patient_id) {
      dutyToPatient.set(String(d.id), String(d.patient_id));
    }
  }

  function ensureRow(map: Map<string, PayoutPatientBreakdownRow>, patientId: string) {
    let row = map.get(patientId);
    if (!row) {
      row = {
        patient_id: patientId,
        patient_name: "",
        duty_count: 0,
        hours: 0,
        amount: 0,
        dates: [],
        duty_ids: []
      };
      map.set(patientId, row);
    }
    return row;
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
    const row = ensureRow(map, patientId);
    if (present) {
      row.duty_count += 1;
      row.hours += hours;
    }
    if (d.id) row.duty_ids.push(String(d.id));
  }

  for (const c of charges) {
    const parsed = parseDutyIdFromRemarks(c.remarks);
    let patientId = parsed ? dutyToPatient.get(parsed.dutyId) || "" : "";
    if (!patientId) {
      // Best-effort fallback: derive from charge date by finding any duty in
      // window for that date. Keeps the sum honest when remarks are missing.
      const dateStr = parsed?.isoDate || String(c.date || "").slice(0, 10);
      if (dateStr) {
        const fallback = duties.find((d) => {
          if (!d.patient_id) return false;
          const start = String(d.start_at || "").slice(0, 10);
          return start <= dateStr; // crude — only used when remarks are absent
        });
        if (fallback) patientId = String(fallback.patient_id || "");
      }
    }
    if (!patientId) continue;
    const row = ensureRow(map, patientId);
    row.amount += Number(c.amount || 0);
    const iso = parsed?.isoDate || String(c.date || "").slice(0, 10);
    if (iso && !row.dates.includes(iso)) row.dates.push(iso);
  }

  // Round amounts + sort dates for stable rendering.
  for (const row of map.values()) {
    row.amount = Math.round(row.amount * 100) / 100;
    row.hours = Math.round(row.hours * 100) / 100;
    row.dates.sort();
  }

  return Array.from(map.values()).sort((a, b) => {
    if (b.amount !== a.amount) return b.amount - a.amount;
    return b.duty_count - a.duty_count;
  });
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
