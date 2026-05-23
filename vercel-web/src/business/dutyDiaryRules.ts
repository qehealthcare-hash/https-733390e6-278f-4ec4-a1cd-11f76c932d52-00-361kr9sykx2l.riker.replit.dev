/**
 * Duty diary rules — per-day patient charges + partner payouts (legacy CRM parity).
 *
 * Legacy `svc_key` = `<billingId>_<serviceName>`.
 * Materialized rows use remarks `duty:<dutyId>:<YYYY-MM-DD>:<employeeId>`.
 */

import { billingSvcKey } from "@/business/billingRules";

export interface DutyPartnerAssignment {
  employee_id: string;
  charge_per_day?: number;
  payout_per_day?: number;
  payout_term?: string;
}

export interface DutyDiaryDayRowInput {
  dutyId: string;
  billingId: string;
  serviceName: string;
  patientId: string;
  employeeId: string;
  employeeName: string;
  isoDate: string;
  shiftType: string;
  chargePerDay: number;
  payoutPerDay: number;
  payoutTerm: string;
  freq?: string;
}

export function dutyDiaryRemarks(dutyId: string, isoDate: string, employeeId: string): string {
  return `duty:${dutyId}:${isoDate}:${employeeId}`;
}

export function isDutyDiaryRemarks(remarks: string | null | undefined): boolean {
  return String(remarks || "").startsWith("duty:");
}

export function dutyIdFromRemarks(remarks: string | null | undefined): string | null {
  const m = String(remarks || "").match(/^duty:([^:]+):/);
  return m ? m[1] : null;
}

export function parseDutyDiaryRemarks(remarks: string | null | undefined): {
  dutyId: string;
  isoDate: string;
  employeeId: string;
} | null {
  const m = String(remarks || "").match(/^duty:([^:]+):(\d{4}-\d{2}-\d{2}):([^:]+)$/);
  if (!m) return null;
  return { dutyId: m[1], isoDate: m[2], employeeId: m[3] };
}

export function diarySlotKey(isoDate: string, employeeId: string): string {
  return `${isoDate}:${employeeId}`;
}

/** Expected per-day × partner slots for a duty window (optional date clip). */
export function expectedDiarySlotKeys(
  startAt: string,
  endAt: string,
  partners: DutyPartnerAssignment[],
  clip?: { from?: string; to?: string }
): Set<string> {
  const keys = new Set<string>();
  for (const isoDate of eachDutyCalendarDay(startAt, endAt)) {
    if (clip?.from && isoDate < clip.from) continue;
    if (clip?.to && isoDate > clip.to) continue;
    for (const p of partners) {
      if (p.employee_id) keys.add(diarySlotKey(isoDate, p.employee_id));
    }
  }
  return keys;
}

/** Inclusive calendar days from duty start through end (UTC date parts). */
export function eachDutyCalendarDay(startAt: string, endAt: string): string[] {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

  const days: string[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));

  while (cursor.getTime() <= last.getTime()) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export function normalizeExtraPartners(raw: unknown): DutyPartnerAssignment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => ({
      employee_id: String((p as DutyPartnerAssignment).employee_id || "").trim(),
      charge_per_day: Number((p as DutyPartnerAssignment).charge_per_day),
      payout_per_day: Number((p as DutyPartnerAssignment).payout_per_day),
      payout_term: String((p as DutyPartnerAssignment).payout_term || "Daily")
    }))
    .filter((p) => p.employee_id);
}

/** Primary employee + extra partners (deduped by employee_id). */
export function collectDutyPartners(
  primaryEmployeeId: string,
  chargePerDay: number,
  payoutPerDay: number,
  payoutTerm: string,
  extra: DutyPartnerAssignment[]
): DutyPartnerAssignment[] {
  const out: DutyPartnerAssignment[] = [];
  const seen = new Set<string>();

  function push(id: string, charge?: number, payout?: number, term?: string) {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({
      employee_id: id,
      charge_per_day: Number.isFinite(charge) && charge! >= 0 ? charge : chargePerDay,
      payout_per_day: Number.isFinite(payout) && payout! >= 0 ? payout : payoutPerDay,
      payout_term: term || payoutTerm || "Daily"
    });
  }

  push(primaryEmployeeId, chargePerDay, payoutPerDay, payoutTerm);
  for (const p of extra) {
    push(p.employee_id, p.charge_per_day, p.payout_per_day, p.payout_term);
  }
  return out;
}

export function buildSvcEntryRow(input: DutyDiaryDayRowInput) {
  const disc = 0;
  const total = Math.max(0, input.chargePerDay - disc);
  return {
    svc_key: billingSvcKey(input.billingId, input.serviceName),
    billing_id: input.billingId,
    service_name: input.serviceName,
    partner: input.employeeName,
    partner_id: input.employeeId,
    date: input.isoDate,
    freq: input.freq || input.shiftType || "Daily",
    amt: input.chargePerDay,
    count: 1,
    disc,
    total,
    remarks: dutyDiaryRemarks(input.dutyId, input.isoDate, input.employeeId)
  };
}

export function buildPayoutChargeRow(input: DutyDiaryDayRowInput) {
  return {
    svc_key: billingSvcKey(input.billingId, input.serviceName),
    billing_id: input.billingId,
    service_name: input.serviceName,
    partner: input.employeeName,
    partner_id: input.employeeId,
    date: input.isoDate,
    term: input.payoutTerm || "Daily",
    amount: input.payoutPerDay,
    remarks: dutyDiaryRemarks(input.dutyId, input.isoDate, input.employeeId)
  };
}
