/**
 * Duty diary rules — per-day patient charges + partner payouts (legacy CRM parity).
 *
 * Legacy `svc_key` = `<billingId>_<serviceName>`.
 * Materialized rows use remarks `duty:<dutyId>:<YYYY-MM-DD>:<employeeId>`.
 */

import { billingSvcKey } from "@/business/billingRules";
import { crmAddDaysIso, crmDateKeyFromTimestamp } from "@/utils/crmToday";
import { clampMoneyNonNegative, roundMoney } from "@/utils/money";

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

/**
 * Per-day diary remarks marker. Optional `:m` suffix means the row was
 * manually edited by an operator from the calendar's day panel and must
 * NOT be overwritten by the next materialize pass. The pruner still owns
 * the slot (so cancelling / shrinking the duty still removes it), but
 * the amount + payout are frozen.
 */
export function dutyDiaryRemarks(
  dutyId: string,
  isoDate: string,
  employeeId: string,
  manual?: boolean
): string {
  const base = `duty:${dutyId}:${isoDate}:${employeeId}`;
  return manual ? `${base}:m` : base;
}

export function isDutyDiaryRemarks(remarks: string | null | undefined): boolean {
  return String(remarks || "").startsWith("duty:");
}

/**
 * Guard for the legacy "replace whole slice" writers in Billing/Payout.
 *
 * Duty-calendar materialized rows (remarks `duty:<dutyId>:<date>:<employeeId>`)
 * are owned solely by the Duty Calendar materializer. Billing and Payout must
 * NEVER create, edit, or delete them through a slice-replace call — the calendar
 * is the single source of truth. This returns the offending rows so callers can
 * fail loudly instead of silently clobbering duty-derived charges.
 */
export function findDutyLedgerRows<T extends { remarks?: string | null }>(
  rows: T[] | null | undefined
): T[] {
  return (rows || []).filter((r) => isDutyDiaryRemarks(r?.remarks));
}

export function dutyIdFromRemarks(remarks: string | null | undefined): string | null {
  const m = String(remarks || "").match(/^duty:([^:]+):/);
  return m ? m[1] || null : null;
}

export function parseDutyDiaryRemarks(remarks: string | null | undefined): {
  dutyId: string;
  isoDate: string;
  employeeId: string;
  manual: boolean;
} | null {
  const m = String(remarks || "").match(/^duty:([^:]+):(\d{4}-\d{2}-\d{2}):([^:]+?)(:m)?$/);
  if (!m) return null;
  return { dutyId: m[1] || "", isoDate: m[2] || "", employeeId: m[3] || "", manual: !!m[4] };
}

export function diarySlotKey(isoDate: string, employeeId: string): string {
  return `${isoDate}:${employeeId}`;
}

/** Operator-skipped diary slot persisted on the duty row (survives sync/cron). */
export interface DutyExcludedDaySlot {
  date: string;
  employee_id: string;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Normalize `hh_duties.excluded_days` JSONB from API / DB reads. */
export function normalizeExcludedDays(raw: unknown): DutyExcludedDaySlot[] {
  if (!Array.isArray(raw)) return [];
  const out: DutyExcludedDaySlot[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const date = String((item as { date?: string }).date || "").trim();
    const employee_id = String((item as { employee_id?: string }).employee_id || "").trim();
    if (!ISO_DAY.test(date) || !employee_id) continue;
    const key = diarySlotKey(date, employee_id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ date, employee_id });
  }
  return out;
}

export function excludedDaySet(slots: DutyExcludedDaySlot[]): Set<string> {
  return new Set(slots.map((s) => diarySlotKey(s.date, s.employee_id)));
}

export function isDayExcluded(
  excluded: Set<string>,
  isoDate: string,
  employeeId: string
): boolean {
  return excluded.has(diarySlotKey(isoDate, employeeId));
}

export function addExcludedDaySlot(
  slots: DutyExcludedDaySlot[],
  isoDate: string,
  employeeId: string
): DutyExcludedDaySlot[] {
  if (!ISO_DAY.test(isoDate) || !employeeId) return slots;
  const key = diarySlotKey(isoDate, employeeId);
  if (slots.some((s) => diarySlotKey(s.date, s.employee_id) === key)) return slots;
  return [...slots, { date: isoDate, employee_id: employeeId }];
}

export function removeExcludedDaySlot(
  slots: DutyExcludedDaySlot[],
  isoDate: string,
  employeeId: string
): DutyExcludedDaySlot[] {
  const key = diarySlotKey(isoDate, employeeId);
  return slots.filter((s) => diarySlotKey(s.date, s.employee_id) !== key);
}

/** Expected per-day × partner slots for a duty window (optional date clip). */
export function expectedDiarySlotKeys(
  startAt: string,
  endAt: string,
  partners: DutyPartnerAssignment[],
  clip?: { from?: string; to?: string; excluded?: Set<string> }
): Set<string> {
  const keys = new Set<string>();
  for (const isoDate of eachDutyCalendarDay(startAt, endAt)) {
    if (clip?.from && isoDate < clip.from) continue;
    if (clip?.to && isoDate > clip.to) continue;
    for (const p of partners) {
      if (!p.employee_id) continue;
      const key = diarySlotKey(isoDate, p.employee_id);
      if (clip?.excluded?.has(key)) continue;
      keys.add(key);
    }
  }
  return keys;
}

/** Inclusive calendar days from duty start through end, computed in the
 *  CRM (IST) timezone — so a duty starting at 18:30 UTC (which is 00:00
 *  IST the next day) begins on the IST calendar day, NOT on the prior
 *  UTC date. Both ends are inclusive: a duty's actual service days are
 *  every IST day its window touches.
 *
 *  Cross-duty handover collisions (same IST day touched by two duties)
 *  are deduplicated AFTER materialize by the service layer — keeping
 *  the entry from the duty with the latest start_at — so this rule
 *  stays simple and doesn't need cross-duty context.
 */
export function eachDutyCalendarDay(startAt: string, endAt: string): string[] {
  if (!startAt || !endAt) return [];
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  if (start.getTime() > end.getTime()) return [];

  const startKey = crmDateKeyFromTimestamp(startAt);
  const endKey = crmDateKeyFromTimestamp(endAt);

  const days: string[] = [];
  let cur = startKey;
  while (cur <= endKey) {
    days.push(cur);
    if (cur === endKey) break;
    cur = crmAddDaysIso(cur, 1);
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

export function buildSvcEntryRow(input: DutyDiaryDayRowInput, actorEmail?: string) {
  const disc = 0;
  const total = clampMoneyNonNegative(input.chargePerDay - disc);
  return {
    svc_key: billingSvcKey(input.billingId, input.serviceName),
    billing_id: input.billingId,
    service_name: input.serviceName,
    partner: input.employeeName,
    partner_id: input.employeeId,
    date: input.isoDate,
    freq: input.freq || input.shiftType || "Daily",
    amt: roundMoney(input.chargePerDay),
    count: 1,
    disc,
    total,
    remarks: dutyDiaryRemarks(input.dutyId, input.isoDate, input.employeeId),
    duty_id: input.dutyId,
    ...(actorEmail ? { created_by: actorEmail, updated_by: actorEmail } : {})
  };
}

export function buildPayoutChargeRow(input: DutyDiaryDayRowInput, actorEmail?: string) {
  return {
    svc_key: billingSvcKey(input.billingId, input.serviceName),
    billing_id: input.billingId,
    service_name: input.serviceName,
    partner: input.employeeName,
    partner_id: input.employeeId,
    date: input.isoDate,
    term: input.payoutTerm || "Daily",
    amount: roundMoney(input.payoutPerDay),
    remarks: dutyDiaryRemarks(input.dutyId, input.isoDate, input.employeeId),
    duty_id: input.dutyId,
    ...(actorEmail ? { created_by: actorEmail, updated_by: actorEmail } : {})
  };
}
