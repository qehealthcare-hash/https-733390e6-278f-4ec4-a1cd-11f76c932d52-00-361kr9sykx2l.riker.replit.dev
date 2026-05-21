import type { ShiftRates } from "@/validation/billingValidation";
import { DEFAULT_SHIFT_RATES } from "@/validation/billingValidation";

export type { ShiftRates };
export { DEFAULT_SHIFT_RATES };

export function amountForShift(shift: string, overrides?: Partial<ShiftRates>): number {
  const rates: ShiftRates = { ...DEFAULT_SHIFT_RATES, ...(overrides || {}) };
  const key = (shift || "DAY").toUpperCase() as keyof ShiftRates;
  return rates[key] ?? rates.DAY;
}

export interface BillingLine {
  total?: number | string | null;
  amount?: number | string | null;
}

export interface BillingTotals {
  services: number;
  receipts: number;
  sec_dep: number;
  outstanding: number;
}

export function sumServiceTotals(lines: BillingLine[]): number {
  return lines.reduce((sum, r) => sum + Number(r.total || 0), 0);
}

export function sumReceiptAmounts(lines: BillingLine[]): number {
  return lines.reduce((sum, r) => sum + Number(r.amount || 0), 0);
}

export function computeBillingTotals(
  services: BillingLine[],
  receipts: BillingLine[],
  secDep = 0
): BillingTotals {
  const servicesTotal = sumServiceTotals(services);
  const receiptsTotal = sumReceiptAmounts(receipts);
  const sec_dep = Number(secDep || 0);
  return {
    services: servicesTotal,
    receipts: receiptsTotal,
    sec_dep,
    outstanding: Math.max(0, servicesTotal - receiptsTotal)
  };
}

export function serviceKey(patientId: string, serviceName: string): string {
  return `${patientId}|${serviceName}`;
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
}

/** Row shape for `hh_svc_entries` insert from a duty. */
export function buildServiceEntryFromDuty(input: ServiceEntryFromDutyInput) {
  const date = dutyServiceDate(input.startAt);
  const amount = input.amount;
  return {
    svc_key: serviceKey(input.patientId, input.serviceName),
    billing_id: input.billingId,
    service_name: input.serviceName,
    partner: input.employeeId || "",
    date,
    freq: input.shiftType,
    amt: amount,
    count: 1,
    disc: 0,
    total: amount,
    remarks: dutyRemarksKey(input.dutyId)
  };
}
