/**
 * Payout module UI helpers (M9 Pass D).
 *
 * Pure date/form utilities — no API calls.
 */

import { crmDateKeyFromTimestamp, crmTodayIso } from "@/src/utils/crmToday";

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

export function emptyAdjustForm() {
  return { advance: 0, deduction: 0, bonus: 0, remarks: "" };
}

export function emptyPayForm() {
  return {
    paid_on: crmTodayIso(),
    method: "UPI",
    amount: "",
    remarks: "",
    proof: null as null | Record<string, unknown>
  };
}

export function emptyAdvanceForm() {
  return {
    paid_on: crmTodayIso(),
    method: "UPI",
    amount: "",
    remarks: "",
    proof: null as null | Record<string, unknown>
  };
}
