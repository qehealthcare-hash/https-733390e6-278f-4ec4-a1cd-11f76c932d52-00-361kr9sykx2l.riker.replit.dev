import type { ApiResult } from "@/types/common";
import { businessFailure, businessOk } from "@/business/businessResult";
import type { BillingStatus, ShiftRates } from "@/validation/billingValidation";
import {
  BILLING_CLOSED_STATUSES,
  BILLING_OPEN_STATUSES,
  DEFAULT_SHIFT_RATES
} from "@/validation/billingValidation";

export type { ShiftRates, BillingStatus };
export { DEFAULT_SHIFT_RATES, BILLING_CLOSED_STATUSES, BILLING_OPEN_STATUSES };

// ───────────────────────────────────────────────────────────────────────────
// Shift rate math
// ───────────────────────────────────────────────────────────────────────────

export function amountForShift(shift: string, overrides?: Partial<ShiftRates>): number {
  const rates: ShiftRates = { ...DEFAULT_SHIFT_RATES, ...(overrides || {}) };
  const key = (shift || "DAY").toUpperCase() as keyof ShiftRates;
  return rates[key] ?? rates.DAY;
}

// ───────────────────────────────────────────────────────────────────────────
// Totals (single source of truth — never compute totals in the UI)
// ───────────────────────────────────────────────────────────────────────────

export interface BillingLine {
  total?: number | string | null;
  amount?: number | string | null;
}

export interface BillingTotals {
  services: number;
  receipts: number;
  sec_dep: number;
  discount: number;
  advance: number;
  outstanding: number;
}

export function sumServiceTotals(lines: BillingLine[]): number {
  return lines.reduce((sum, r) => sum + Number(r.total || 0), 0);
}

export function sumReceiptAmounts(lines: BillingLine[]): number {
  return lines.reduce((sum, r) => sum + Number(r.amount || 0), 0);
}

export interface BillingTotalsInput {
  services: BillingLine[];
  receipts: BillingLine[];
  secDep?: number;
  discount?: number;
  advance?: number;
}

export function computeBillingTotals(
  servicesOrInput: BillingLine[] | BillingTotalsInput,
  receipts?: BillingLine[],
  secDep = 0
): BillingTotals {
  let services: BillingLine[];
  let r: BillingLine[];
  let sec: number;
  let discount = 0;
  let advance = 0;

  if (Array.isArray(servicesOrInput)) {
    services = servicesOrInput;
    r = receipts || [];
    sec = Number(secDep || 0);
  } else {
    services = servicesOrInput.services;
    r = servicesOrInput.receipts;
    sec = Number(servicesOrInput.secDep || 0);
    discount = Number(servicesOrInput.discount || 0);
    advance = Number(servicesOrInput.advance || 0);
  }

  const servicesTotal = sumServiceTotals(services);
  const receiptsTotal = sumReceiptAmounts(r);
  const outstanding = Math.max(0, servicesTotal - receiptsTotal - discount - advance);
  return {
    services: servicesTotal,
    receipts: receiptsTotal,
    sec_dep: sec,
    discount,
    advance,
    outstanding
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Service-entry shape and duty linkage
// ───────────────────────────────────────────────────────────────────────────

/** Legacy alias key (patient + service) — prefer `billingSvcKey` for diary rows. */
export function serviceKey(patientId: string, serviceName: string): string {
  return `${patientId}|${serviceName}`;
}

/** Legacy duty diary `svc_key`: `<billingId>_<serviceName>`. */
export function billingSvcKey(billingId: string, serviceName: string): string {
  return `${billingId}_${serviceName}`;
}

export function dutyRemarksKey(dutyId: string): string {
  return `duty:${dutyId}`;
}

export function dutyServiceDate(startAt: string): string {
  return startAt.slice(0, 10);
}

export interface ServiceEntryFromDutyInput {
  dutyId: string;
  patientId: string;
  billingId: string;
  employeeId: string;
  startAt: string;
  shiftType: string;
  serviceName: string;
  amount: number;
  discount?: number;
}

export function buildServiceEntryFromDuty(input: ServiceEntryFromDutyInput) {
  const date = dutyServiceDate(input.startAt);
  const amount = input.amount;
  const disc = Number(input.discount || 0);
  const total = Math.max(0, amount - disc);
  return {
    svc_key: billingSvcKey(input.billingId, input.serviceName),
    billing_id: input.billingId,
    service_name: input.serviceName,
    partner: input.employeeId || "",
    partner_id: input.employeeId || "",
    date,
    freq: input.shiftType,
    amt: amount,
    count: 1,
    disc,
    total,
    remarks: dutyRemarksKey(input.dutyId)
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Period helpers
// ───────────────────────────────────────────────────────────────────────────

/** YYYY-MM key for a calendar timestamp. */
export function billingPeriodOf(timestamp: string | null | undefined): string {
  return String(timestamp || "").slice(0, 7);
}

/** Derive the billing period from a list of service entries — earliest…latest. */
export function periodFromServices(services: Array<{ date?: string | null }>): {
  from?: string;
  to?: string;
  months: string[];
} {
  const dates = services
    .map((s) => String(s.date || "").slice(0, 10))
    .filter(Boolean)
    .sort();
  const months = Array.from(new Set(dates.map((d) => d.slice(0, 7))));
  return {
    from: dates[0],
    to: dates[dates.length - 1],
    months
  };
}

/** Does duty.start_at fall in the requested YYYY-MM period? */
export function dutyInPeriod(dutyStartAt: string, period: string | undefined): boolean {
  if (!period) return true;
  return billingPeriodOf(dutyStartAt) === period;
}

// ───────────────────────────────────────────────────────────────────────────
// Status guards
// ───────────────────────────────────────────────────────────────────────────

export function isBillingClosed(status: string | null | undefined): boolean {
  return BILLING_CLOSED_STATUSES.has(String(status || "") as BillingStatus);
}

export function isBillingActive(status: string | null | undefined): boolean {
  return BILLING_OPEN_STATUSES.has(String(status || "") as BillingStatus);
}

/** Edits / new svc / new receipts only allowed when bill is open. */
export function canEditBilling(status: string | null | undefined): ApiResult<null> {
  if (isBillingClosed(status)) {
    return businessFailure(
      `Bill is ${status}; reopen the bill before editing`,
      { status }
    );
  }
  return businessOk();
}

/**
 * Closing rules: at least one service entry must exist, and `force=false`
 * disallows closing if there's outstanding amount > 0.
 */
export function canCloseBilling(
  totals: BillingTotals,
  serviceCount: number,
  force: boolean
): ApiResult<null> {
  if (serviceCount === 0) {
    return businessFailure("Cannot close a bill with no service entries");
  }
  if (!force && totals.outstanding > 0) {
    return businessFailure(
      `Bill has ₹${totals.outstanding} outstanding — record payment first or close with force flag`,
      { outstanding: totals.outstanding }
    );
  }
  return businessOk();
}

/** Reopening is only allowed when the current status is Closed. */
export function canReopenBilling(status: string | null | undefined): ApiResult<null> {
  if (status !== "Closed") {
    return businessFailure(
      `Only Closed bills can be reopened (current status: ${status || "unknown"})`,
      { status }
    );
  }
  return businessOk();
}

/**
 * Status transition matrix — illegal transitions short-circuit.
 *
 * Allowed:
 *   Active   → Paused | Closed | Cancelled
 *   Paused   → Active | Cancelled       (must Reopen to bill again)
 *   Closed   → Active                   (reopen path)
 *   Cancelled→ (terminal — nothing)
 */
export function canTransitionTo(
  current: string | null | undefined,
  next: BillingStatus
): ApiResult<null> {
  const from = String(current || "Active") as BillingStatus;
  if (from === next) return businessOk();
  if (from === "Cancelled") {
    return businessFailure("Cancelled bills are terminal");
  }
  if (from === "Closed" && next === "Cancelled") {
    return businessFailure("Cancel a bill before closing — Closed → Cancelled is not allowed");
  }
  if (from === "Closed" && next === "Paused") {
    return businessFailure("Closed bills must be Reopened (Active) before they can be Paused");
  }
  if (from === "Paused" && next === "Closed") {
    return businessFailure("Reactivate a Paused bill before closing it so totals are recomputed");
  }
  return businessOk();
}

// ───────────────────────────────────────────────────────────────────────────
// Patches applied to hh_billings
// ───────────────────────────────────────────────────────────────────────────

/** Status-only patch — close metadata is stored in hh_audit_logs (production may lack close_reason columns). */
export function billingCloseRow(_actorEmail: string, _reason?: string, _otherReason?: string) {
  return { status: "Closed" as BillingStatus };
}

export function billingPauseRow(_actorEmail: string, _pauseReason?: string) {
  return { status: "Paused" as BillingStatus };
}

export function billingReopenRow(_actorEmail: string, _reason?: string) {
  return { status: "Active" as BillingStatus };
}

export function billingStatusRow(status: BillingStatus, _actorEmail: string) {
  return { status };
}

// ───────────────────────────────────────────────────────────────────────────
// Duty linkage rules (mirrors dutyRules.canCancelDutyWithBilling)
// ───────────────────────────────────────────────────────────────────────────

/**
 * When generating a bill from a duty, the bill must still be open or absent.
 * Returns a failure when the duty is already linked to a *closed* bill so the
 * UI gets a clear "reopen the bill first" message.
 */
export function canBillDuty(
  duty: { billing_id?: string | null; status?: string | null; patient_id?: string | null },
  existingBillingStatus: string | null | undefined
): ApiResult<null> {
  if (!duty.patient_id) {
    return businessFailure("Duty has no patient — cannot bill", { duty_id: duty.billing_id });
  }
  const status = String(duty.status || "").toUpperCase();
  if (status === "CANCELLED" || status === "NO_SHOW") {
    return businessFailure(`Cannot bill a duty with status ${status}`);
  }
  if (duty.billing_id && isBillingClosed(existingBillingStatus)) {
    return businessFailure(
      `Duty already linked to a ${existingBillingStatus} bill — reopen it before re-billing`,
      { billing_id: duty.billing_id, status: existingBillingStatus }
    );
  }
  return businessOk();
}
