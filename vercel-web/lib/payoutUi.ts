/**
 * Payout module UI helpers (M9 Pass D).
 *
 * Pure date/form utilities — no API calls.
 */

import type { PayoutDetailDto } from "@/validation/payoutDto";
import { crmDateKeyFromTimestamp, crmTodayIso } from "@/src/utils/crmToday";

export { apiErrorMessage, isApiConflictError } from "@/lib/apiClientErrors";

/** Optimistic-lock token from the loaded payout row (`updated_at`). */
export function payoutExpectedUpdatedAt(detail: PayoutDetailDto | null | undefined): string {
  return String(detail?.payout?.updated_at || "").trim();
}

export const PAYOUT_STATUS_OPTIONS = [
  { value: "OPEN", label: "Open" },
  { value: "LOCKED", label: "Locked" },
  { value: "PAID", label: "Paid" }
] as const;

/** IST calendar date (YYYY-MM-DD) for a stored ISO timestamp. */
export function istDayKey(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return crmDateKeyFromTimestamp(iso);
}

/** Payout period (YYYY-MM) in IST. */
export function currentPeriod(): string {
  return crmTodayIso().slice(0, 7);
}

export interface PayoutEnsureForm {
  employee_id: string;
  period_month: string;
  advance: number | string;
  deduction: number | string;
  bonus: number | string;
  remarks: string;
}

export function emptyEnsureForm(): PayoutEnsureForm {
  return {
    employee_id: "",
    period_month: currentPeriod(),
    advance: 0,
    deduction: 0,
    bonus: 0,
    remarks: ""
  };
}

export const PAYOUTS_LIMIT = 200;

export function roleInList(
  role: string | undefined | null,
  list: readonly string[]
): boolean {
  const normalized = String(role || "").trim().toLowerCase();
  return list.some(function (r) {
    return r.toLowerCase() === normalized;
  });
}

export interface PayoutProofAttachment {
  bucket?: string;
  path?: string;
  file_name?: string;
  preview_url?: string | null;
  mime?: string;
  size?: number;
}

export interface PayoutAdjustForm {
  advance: number | string;
  deduction: number | string;
  bonus: number | string;
  remarks: string;
}

export interface PayoutPayForm {
  employee_id?: string;
  paid_on: string;
  method: string;
  amount: string;
  remarks: string;
  proof: PayoutProofAttachment | null;
}

export interface PayoutAdvanceForm {
  employee_id?: string;
  paid_on: string;
  method: string;
  amount: string;
  remarks: string;
  proof: PayoutProofAttachment | null;
}

export function emptyAdjustForm(): PayoutAdjustForm {
  return { advance: 0, deduction: 0, bonus: 0, remarks: "" };
}

export function emptyPayForm(): PayoutPayForm {
  return {
    paid_on: crmTodayIso(),
    method: "UPI",
    amount: "",
    remarks: "",
    proof: null
  };
}

export function emptyAdvanceForm(): PayoutAdvanceForm {
  return {
    paid_on: crmTodayIso(),
    method: "UPI",
    amount: "",
    remarks: "",
    proof: null
  };
}

export interface EmployeeLookupRow {
  id: string;
  name?: string;
  full_name?: string;
}

export interface PayoutListRow {
  id: string;
  employee_id?: string;
  period_month?: string;
  status?: string;
  net_amount?: number;
  gross_amount?: number;
  employee_name?: string;
  duty_count?: number;
  hours?: number;
  created_by?: string;
  updated_by?: string;
  created_at?: string;
  updated_at?: string;
  paid_at?: string;
}

export interface PayoutListEnvelope {
  rows?: PayoutListRow[];
  total?: number;
}

export interface UnpaidEmployeeRow {
  employee_id?: string;
  employee_name?: string;
  pending_amount?: number;
  pending?: number;
  charged?: number;
  paid?: number;
  duty_count?: number;
  payout_status?: string;
  payout_id?: string;
}

export interface UnpaidEmployeesState {
  period: string;
  rows: UnpaidEmployeeRow[];
  total_pending: number;
  loading: boolean;
  source: string;
  error: string;
}

export interface PatientBreakdownRow {
  patient_id?: string;
  patient_name?: string;
  days_worked?: number;
  charged_days?: number;
  hours?: number;
  first_date?: string;
  last_date?: string;
  amount?: number;
  duty_ids?: string[];
}

export interface PayoutDiagnostics {
  warning?: string;
  charge_row_count?: number;
  charge_sum?: number;
  charge_zero_rate_rows?: number;
  charge_distinct_svc_keys?: number;
  attendance_payable_count?: number;
  attendance_payable_hours?: number;
  attendance_row_count?: number;
  duty_row_count?: number;
  duty_statuses?: Record<string, number>;
  charge_last_updated_at?: string;
  duties_needing_rate?: Record<string, unknown>[];
}

export interface PendingSummary {
  employee_id?: string;
  employee_name?: string;
  period?: string;
  duty_count?: number;
  hours?: number;
  charged?: number;
  paid?: number;
  pending?: number;
  payout?: { status?: string; id?: string };
  paid_transactions?: Record<string, unknown>[];
}

export function emptyUnpaidEmployeesState(): UnpaidEmployeesState {
  return {
    period: "",
    rows: [],
    total_pending: 0,
    loading: false,
    source: "rpc",
    error: ""
  };
}

export interface AuditTrailRow {
  id?: string;
  created_at?: string;
  action?: string;
  actor_name?: string;
  actor?: string;
  stamp?: string;
  details?: string;
}
