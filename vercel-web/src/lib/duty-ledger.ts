/**
 * Duty Ledger — the single calculation authority.
 *
 * FINAL BUSINESS RULE: the Duty Calendar is the ONLY editable operational
 * source. Billing, Attendance and Payout are read-only calculators derived
 * from the duty-materialized ledgers:
 *   - hh_svc_entries     (patient billing, one row per duty-day)
 *   - hh_payout_charges  (employee payout, one row per duty-day)
 *
 * Every module (Billing, Payout, Attendance, Duty Calendar totals, Dashboard,
 * Reports, Cron) must read its numbers through this service so there is exactly
 * ONE definition of "billing total" and "payout total". No module re-derives
 * amounts from shift-rate defaults or any other independent formula.
 *
 * This module imports repositories + pure business helpers only. Recompute
 * helpers use lazy `await import(...)` for service-layer materialization to
 * avoid static import cycles (the established pattern in this codebase).
 */

import type { ApiResult } from "@/types/common";
import type { DbAccess, JsonRow } from "@/database/types";
import { success, passFailure } from "@/utils/apiResponse";
import { payoutRepository } from "@/database/payoutRepository";
import { billingRepository } from "@/database/billingRepository";
import { dutyRepository } from "@/database/dutyRepository";
import { sumServiceTotals, sumReceiptAmounts } from "@/business/billingRules";
import { moneyOutstanding, roundMoney } from "@/utils/money";
import { isPayoutLocked } from "@/business/payoutRules";
import {
  dutyIdFromRemarks,
  isDutyDiaryRemarks
} from "@/business/dutyDiaryRules";

/** First/last calendar day (YYYY-MM-DD) for a YYYY-MM period. */
function monthBounds(period: string): { from: string; to: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(String(period || ""));
  if (!m) return { from: `${period}-01`, to: `${period}-31` };
  const year = Number(m[1]);
  const month = Number(m[2]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(lastDay).padStart(2, "0")}` };
}

function inPeriod(dateValue: unknown, period: string): boolean {
  return typeof dateValue === "string" && dateValue.slice(0, 7) === period;
}

// ───────────────────────────── Employee payout ─────────────────────────────

export interface EmployeePayoutLedger {
  employee_id: string;
  period: string;
  /** Number of active duty-calendar payout rows in the period. */
  duty_count: number;
  /** Sum of hh_payout_charges.amount for the period (gross). */
  gross: number;
  /** Disbursements already paid for the period. */
  paid: number;
  /** gross − paid, floored at 0. */
  outstanding: number;
  /** Payable hours rolled up for the period. */
  hours: number;
  /** Source hh_payout_charges row ids that make up this ledger. */
  source_row_ids: string[];
  /** Distinct service days included. */
  dates: string[];
}

/**
 * Authoritative employee payout for a month, summed live from
 * hh_payout_charges (never from the cached hh_payouts aggregate).
 */
export async function getEmployeePayoutLedger(
  employeeId: string,
  period: string,
  access?: DbAccess
): Promise<ApiResult<EmployeePayoutLedger>> {
  const [pending, charges] = await Promise.all([
    payoutRepository.pendingPayoutRpc(employeeId, period, access),
    payoutRepository.listChargesByEmployeePeriod(employeeId, period, access)
  ]);
  if (!pending.success) return passFailure(pending);
  if (!charges.success) return passFailure(charges);

  const rows = charges.data || [];
  const gross = Number(pending.data?.charged ?? rows.reduce((s, r) => s + Number(r.amount || 0), 0));
  const paid = Number(pending.data?.paid || 0);
  const dutyCount = Number(pending.data?.duty_count ?? rows.length);

  return success({
    employee_id: employeeId,
    period,
    duty_count: dutyCount,
    gross,
    paid,
    outstanding: Math.max(0, gross - paid),
    hours: Number(pending.data?.hours || 0),
    source_row_ids: rows.map((r) => String(r.id)).filter(Boolean),
    dates: Array.from(new Set(rows.map((r) => String(r.date || "")).filter(Boolean))).sort()
  });
}

// ───────────────────────────── Patient billing ─────────────────────────────

export interface PatientBillingLedger {
  patient_id: string;
  period: string;
  /** Number of active duty-calendar billing rows in the period. */
  duty_count: number;
  /** Sum of hh_svc_entries.total for the period (billed). */
  billed: number;
  /** Receipts recorded in the period. */
  received: number;
  /** billed − received, floored at 0. */
  outstanding: number;
  /** Source hh_svc_entries row ids that make up this ledger. */
  source_row_ids: string[];
}

/**
 * Authoritative patient billing for a month, summed live from hh_svc_entries
 * (the duty-materialized billing ledger). Manual / ad-hoc invoice lines are
 * intentionally NOT part of this duty ledger and are surfaced separately by
 * the billing module.
 */
export async function getPatientBillingLedger(
  patientId: string,
  period: string,
  access?: DbAccess
): Promise<ApiResult<PatientBillingLedger>> {
  const bills = await billingRepository.listBillingsByPatient(patientId, access);
  if (!bills.success) return passFailure(bills);
  const billingIds = (bills.data || []).map((b) => String(b.id)).filter(Boolean);
  if (billingIds.length === 0) {
    return success({
      patient_id: patientId,
      period,
      duty_count: 0,
      billed: 0,
      received: 0,
      outstanding: 0,
      source_row_ids: []
    });
  }

  const [svcAll, rcptAll] = await Promise.all([
    billingRepository.listSvcByBillingIds(billingIds, access),
    billingRepository.listActiveReceiptsByBillingIds(billingIds, access)
  ]);
  if (!svcAll.success) return passFailure(svcAll);
  if (!rcptAll.success) return passFailure(rcptAll);

  const svcRows = (svcAll.data || []).filter((s) => inPeriod(s.date, period));
  const dutySvcRows = svcRows.filter((s) => isDutyDiaryRemarks(String(s.remarks ?? "")));
  const rcptRows = (rcptAll.data || []).filter((r) => inPeriod(r.date, period));
  // Reuse the SAME billed/received formula reports + billing use, so there is
  // exactly one definition of these totals across the whole app.
  const billed = sumServiceTotals(svcRows);
  const received = sumReceiptAmounts(rcptRows);

  return success({
    patient_id: patientId,
    period,
    duty_count: dutySvcRows.length,
    billed: roundMoney(billed),
    received: roundMoney(received),
    outstanding: moneyOutstanding(billed, received),
    source_row_ids: dutySvcRows.map((r) => String(r.id)).filter(Boolean)
  });
}

// ───────────────────────────── Dashboard duty KPIs ─────────────────────────────

export interface DashboardDutyKpis {
  duties_active: number;
  duties_scheduled: number;
  duties_completed: number;
  duties_cancelled: number;
}

/**
 * Duty-day counts for dashboard KPIs — derived ONLY from materialized
 * hh_svc_entries rows (duty:% remarks). Status buckets join read-only to
 * hh_duties.status so we never count master duty rows as "days".
 */
export function computeDashboardDutyKpisFromLedger(
  svcRows: JsonRow[],
  dutiesById?: Map<string, JsonRow>
): DashboardDutyKpis {
  const dutyRows = (svcRows || []).filter((r) => isDutyDiaryRemarks(String(r.remarks ?? "")));
  if (!dutiesById || dutiesById.size === 0) {
    const total = dutyRows.length;
    return {
      duties_active: total,
      duties_scheduled: 0,
      duties_completed: total,
      duties_cancelled: 0
    };
  }
  let active = 0;
  let scheduled = 0;
  let completed = 0;
  let cancelled = 0;
  for (const row of dutyRows) {
    const dutyId = dutyIdFromRemarks(String(row.remarks || ""));
    const status = String((dutyId && dutiesById.get(dutyId)?.status) || "").toUpperCase();
    if (status === "SCHEDULED") scheduled += 1;
    else if (status === "IN_PROGRESS") active += 1;
    else if (status === "COMPLETED") completed += 1;
    else if (status === "CANCELLED" || status === "NO_SHOW" || status === "DELETED") cancelled += 1;
    else active += 1;
  }
  return { duties_active: active, duties_scheduled: scheduled, duties_completed: completed, duties_cancelled: cancelled };
}

/** Bulk attendance rollups from materialized payout charges (one row per duty-day). */
export async function listAttendanceLedgersForPeriod(
  period: string,
  access?: DbAccess,
  opts?: { employee_id?: string }
): Promise<ApiResult<Map<string, AttendanceLedger>>> {
  const charges = opts?.employee_id
    ? await payoutRepository.listChargesByEmployeePeriod(opts.employee_id, period, access)
    : await payoutRepository.listAllChargesForPeriod(period, access);
  if (!charges.success) return passFailure(charges);
  const byEmployee = new Map<string, Set<string>>();
  for (const row of charges.data || []) {
    const emp = String(row.partner_id || row.partner || "").trim();
    const date = String(row.date || "").trim();
    if (!emp || !date) continue;
    if (!isDutyDiaryRemarks(String(row.remarks ?? ""))) continue;
    let dates = byEmployee.get(emp);
    if (!dates) {
      dates = new Set();
      byEmployee.set(emp, dates);
    }
    dates.add(date);
  }
  const out = new Map<string, AttendanceLedger>();
  for (const [employee_id, dates] of byEmployee) {
    const sorted = [...dates].sort();
    out.set(employee_id, {
      employee_id,
      period,
      present_days: sorted.length,
      dates: sorted
    });
  }
  return success(out);
}

// ───────────────────────────── Duty rows ─────────────────────────────

/** Active duty rows whose [start_at, end_at] window touches the period. */
export async function getDutyRowsByPeriod(
  period: string,
  access?: DbAccess
): Promise<ApiResult<JsonRow[]>> {
  const { from, to } = monthBounds(period);
  const res = await dutyRepository.list({ from, to }, access);
  if (!res.success) return passFailure(res);
  return success(res.data?.rows || []);
}

// ───────────────────────────── Attendance (derived view) ─────────────────────────────

export interface AttendanceLedger {
  employee_id: string;
  period: string;
  /** Days the employee has a materialized payout charge = worked/duty days. */
  present_days: number;
  dates: string[];
}

/**
 * Attendance derived strictly from the duty calendar ledger. This is a
 * read-only projection — corrections must be made on the Duty Calendar.
 */
export async function getAttendanceLedger(
  employeeId: string,
  period: string,
  access?: DbAccess
): Promise<ApiResult<AttendanceLedger>> {
  const charges = await payoutRepository.listChargesByEmployeePeriod(employeeId, period, access);
  if (!charges.success) return passFailure(charges);
  const dates = Array.from(
    new Set((charges.data || []).map((r) => String(r.date || "")).filter(Boolean))
  ).sort();
  return success({ employee_id: employeeId, period, present_days: dates.length, dates });
}

// ───────────────────────────── Recompute ─────────────────────────────

/** Refresh the cached hh_payouts aggregate for one employee/month from the ledger. */
export async function recomputeEmployeePayout(
  employeeId: string,
  period: string,
  access?: DbAccess
): Promise<ApiResult<{ payout_id?: string; gross?: number; duties?: number } | null>> {
  const existing = await payoutRepository.findByEmployeePeriod(employeeId, period, access);
  if (!existing.success) return passFailure(existing);
  if (existing.data && isPayoutLocked(String(existing.data.status || ""))) {
    return success(null);
  }
  return payoutRepository.recomputeRpc(employeeId, period, access);
}

interface RecomputeCtx {
  actor: { email?: string };
  [k: string]: unknown;
}

/** Re-materialize a patient's duty ledger into svc + payout rows for the active bill. */
export async function recomputePatientBilling(
  patientId: string,
  _period: string,
  ctx: RecomputeCtx
): Promise<ApiResult<unknown>> {
  const { dutyService } = await import("@/services/dutyService");
  return dutyService.extendForPatient(patientId, ctx as never);
}

/** Attendance is derived from the duty ledger; recompute = refresh payout aggregate. */
export async function recomputeAttendance(
  employeeId: string,
  period: string,
  access?: DbAccess
): Promise<ApiResult<unknown>> {
  return recomputeEmployeePayout(employeeId, period, access);
}

/**
 * Fan-out recompute after any Duty Calendar change: refreshes the affected
 * patient billing and every affected employee payout/month.
 */
export async function recomputeAllForDutyChange(
  dutyId: string,
  ctx: RecomputeCtx,
  access?: DbAccess
): Promise<ApiResult<{ duty_id: string; employees: number }>> {
  const dutyRes = await dutyRepository.findById(dutyId, access);
  if (!dutyRes.success) return passFailure(dutyRes);
  const duty = dutyRes.data;
  if (!duty) return success({ duty_id: dutyId, employees: 0 });

  const patientId = String(duty.patient_id || "");
  if (patientId) {
    await recomputePatientBilling(patientId, "", ctx);
  }

  // Recompute every (employee, period) the duty's charges touch.
  const charges = await dutyRepository.findPayoutChargesByDutyId(dutyId, access);
  const seen = new Set<string>();
  if (charges.success) {
    for (const row of charges.data || []) {
      const emp = String(row.partner_id || row.partner || "");
      const period = String(row.date || "").slice(0, 7);
      if (!emp || !/^\d{4}-\d{2}$/.test(period)) continue;
      const key = `${emp}|${period}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await recomputeEmployeePayout(emp, period, access);
    }
  }
  return success({ duty_id: dutyId, employees: seen.size });
}
