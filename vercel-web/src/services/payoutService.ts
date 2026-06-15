/**
 * Payout service — corporate-grade layered facade.
 *
 * Composes /src/validation/payoutValidation + /src/business/payoutRules +
 * /src/database/payoutRepository + /src/database/dutyRepository +
 * /src/database/attendanceRepository + /src/database/auditRepository.
 *
 * Hardened rules (Phase 5 Payout):
 *   - Gross / duty_count / hours are *always* computed by
 *     `hh_recompute_payout` from duty-calendar payout charges — never trusted
 *     from the frontend.
 *   - Adjustments (advance / deduction / bonus / remarks) flow through
 *     `mergePayoutAdjustments` which recomputes `net_amount` server-side.
 *   - One payout row per `(employee_id, period_month)` (matches the DB
 *     `hh_payouts_unique` constraint). Multi-patient breakdown is *derived*
 *     from duties / attendance and surfaced for UI / reports.
 *   - Status machine `OPEN → LOCKED → PAID` with reopen requiring an
 *     audited reason. PAID is terminal.
 *   - Every mutation refetches the persisted row + writes an audit log.
 */

import type { ApiResult } from "@/types/common";
import { ErrorCodes } from "@/types/common";
import {
  payoutSchema,
  payoutAdjustmentSchema,
  payoutPaySchema,
  payoutAdvanceSchema,
  payoutLockSchema,
  payoutReopenSchema,
  payoutRecomputeSchema,
  payoutListQuerySchema,
  payoutPendingQuerySchema,
  type PayoutInput,
  type PayoutAdjustmentInput,
  type PayoutPayInput,
  type PayoutAdvanceInput,
  type PayoutLockInput,
  type PayoutReopenInput,
  type PayoutRecomputeInput,
  type PayoutListQuery,
  type PayoutPendingQuery
} from "@/validation/payoutValidation";
import { parseInput } from "@/validation/parseValidation";
import { roundMoney } from "@/utils/money";
import {
  buildPayoutPermissions,
  canEditPayout,
  canLockPayout,
  canMarkPayoutPaid,
  canPayAdvance,
  canPayoutTransitionTo,
  canReopenPayout,
  computePayoutNet,
  ensurePayoutHasSource,
  ensureWithinPayoutOutstanding,
  isPayoutFullyPaid,
  isPayoutLocked,
  mergePayoutAdjustments,
  payoutLockRow,
  payoutPaidRow,
  payoutReopenRow,
  sumPayoutTotals,
  validatePayoutAmounts,
  type PayoutPatientBreakdownRow,
  type PayoutTotals
} from "@/business/payoutRules";
import { parsePayoutDetailDto, type PayoutPermissionsDto } from "@/validation/payoutDto";
import { assertNotStale } from "@/business/concurrencyRules";
import { monthRangeUTC } from "@/business/dateRules";
import { newId } from "@/business/idRules";
import { payoutRepository } from "@/database/payoutRepository";
import { dutyRepository } from "@/database/dutyRepository";
import { attendanceRepository } from "@/database/attendanceRepository";
import { employeeRepository } from "@/database/employeeRepository";
import { patientRepository } from "@/database/patientRepository";
import { dutyDiaryService } from "@/services/dutyDiaryService";
import { parseDutyDiaryRemarks } from "@/business/dutyDiaryRules";
import {
  DUTY_CALENDAR_LEDGER_REPLACE_DISABLED_MESSAGE,
  dutyCalendarSotFailure
} from "@/business/dutySourceOfTruth";
import { finalizeWithAudit, writeMutationAudit } from "@/services/mutationAudit";
import type { JsonRow } from "@/database/types";
import {
  duplicateFailure,
  failure,
  notFoundFailure,
  passFailure,
  success
} from "@/utils/apiResponse";

import type { ServiceActor } from "@/types/serviceActor";

/** @deprecated Import `ServiceActor` from `@/types/serviceActor`. */
export type ActorLike = ServiceActor;

export interface PayoutServiceContext {
  actor: ServiceActor;
  accessToken?: string;
}

function dbAccess(ctx: PayoutServiceContext) {
  const token = ctx.accessToken ?? ctx.actor.accessToken;
  return token ? { accessToken: token } : undefined;
}

async function fireAudit(
  ctx: PayoutServiceContext,
  payload: {
    entity_id: string;
    action: "create" | "update" | "close" | "delete";
    before?: unknown;
    after?: unknown;
    stamp?: string;
  }
) {
  return writeMutationAudit(dbAccess(ctx), ctx.actor, {
    module: "payout",
    entity_id: payload.entity_id,
    action: payload.action,
    stamp: payload.stamp,
    before: payload.before ?? null,
    after: payload.after ?? null
  });
}

type LoadResult<T> =
  | { success: true; data: T }
  | { success: false; error?: string; code?: string; details?: unknown };

function toLoadFailure(result: ApiResult<unknown>): LoadResult<never> {
  return {
    success: false,
    error: result.error,
    code: result.code,
    details: result.details
  };
}

async function loadPayout(
  id: string,
  ctx: PayoutServiceContext
): Promise<LoadResult<JsonRow>> {
  const row = await payoutRepository.findById(id, dbAccess(ctx));
  if (!row.success) return toLoadFailure(row);
  if (!row.data) return toLoadFailure(notFoundFailure("Payout", id));
  return { success: true, data: row.data };
}

async function loadFreshPayout(
  id: string,
  ctx: PayoutServiceContext,
  fallback?: JsonRow | null
): Promise<LoadResult<JsonRow>> {
  const refreshed = await payoutRepository.findById(id, dbAccess(ctx));
  if (!refreshed.success) return toLoadFailure(refreshed);
  const row = refreshed.data ?? fallback ?? null;
  if (!row) return toLoadFailure(failure("Payout not found after mutation", ErrorCodes.internal));
  return { success: true, data: row };
}

export interface PayoutDetail {
  payout: JsonRow;
  duties: JsonRow[];
  attendance: JsonRow[];
  breakdown: PayoutPatientBreakdownRow[];
  /** All disbursements against this payout (oldest-first). */
  paid_transactions: JsonRow[];
  /** Sum of all disbursement amounts already recorded against this payout. */
  paid_total: number;
  /** Net outstanding = net_amount − paid_total (never negative). */
  outstanding: number;
  /** Display-friendly employee name resolved from `hh_employees`. */
  employee_name: string;
  /**
   * Per-patient breakdown: when an employee works across multiple patients
   * in a period, this lets the UI/PDF list each patient with the days
   * worked, hours, and earnings attributable to that patient.
   */
  patient_breakdown: PayoutPatientSummary[];
  /**
   * Data-source diagnostics. Lets the UI explain "why is Gross 0?" by
   * showing exact row counts and sums from every table feeding this payout.
   * All fields are READ-ONLY; mutating the payout requires the normal
   * ensure / adjust / pay paths.
   */
  diagnostics: PayoutDiagnostics;
  /** Business-layer action flags — authoritative for the payouts UI. */
  permissions: PayoutPermissionsDto;
}

export interface PayoutPatientSummary {
  patient_id: string;
  patient_name: string;
  /** Days the employee actually worked for this patient (PRESENT attendance). */
  days_worked: number;
  /** Total hours across those days. */
  hours: number;
  /** Days where a charge row was materialized (i.e. days the duty was active). */
  charged_days: number;
  /** Sum of `hh_payout_charges.amount` attributed to this patient. */
  amount: number;
  /** Earliest charge date for this patient × employee × period. */
  first_date: string | null;
  /** Latest charge date for this patient × employee × period. */
  last_date: string | null;
  /** Duty ids contributing to the breakdown (audit hint). */
  duty_ids: string[];
}

export interface PayoutDiagnostics {
  /** Rows in `hh_payout_charges` for this employee × period. */
  charge_row_count: number;
  /** Sum of `amount` across those rows — drives `gross_amount`. */
  charge_sum: number;
  /**
   * Number of charge rows with `amount = 0`. A common cause of "duty
   * present but Gross ₹0" is duties saved with `payout_per_day = 0`.
   */
  charge_zero_rate_rows: number;
  /** Distinct svc_keys (billing rows) the charges roll up to. */
  charge_distinct_svc_keys: number;
  /** Most recent updated_at across the charge rows (ISO). */
  charge_last_updated_at: string | null;
  /** Rows in `hh_duties` overlapping the period for this employee. */
  duty_row_count: number;
  /** Distinct duty statuses observed — useful for spotting CANCELLED runs. */
  duty_statuses: Record<string, number>;
  /** Rows in `hh_attendance` for the period (any status). */
  attendance_row_count: number;
  /** Attendance rows counted by `hh_recompute_payout` (PRESENT/LATE/HALF_DAY). */
  attendance_payable_count: number;
  /** Sum of `hours` across payable attendance rows. */
  attendance_payable_hours: number;
  /**
   * Human-friendly hint when something looks off, e.g. "Duties exist but
   * every charge row has amount = 0 — edit the duty to set payout_per_day".
   * Empty when the data flow looks healthy.
   */
  warning: string;
  /**
   * Primary-employee duties whose `payout_per_day` is 0 or null. Surfaced to
   * the UI so the operator can one-click "Set ₹X for all and refresh"
   * instead of opening each duty separately.
   */
  duties_needing_rate: Array<{
    duty_id: string;
    patient_id: string | null;
    service_name: string | null;
    start_at: string | null;
    end_at: string | null;
    status: string | null;
    charge_per_day: number;
    payout_per_day: number;
  }>;
}

/**
 * Compose a display name from an `hh_employees` row. Mirrors the lookup
 * view's resolution so the same name string surfaces in payouts, billing,
 * and duty calendar.
 */
function composeEmployeeName(row: JsonRow | null | undefined): string {
  if (!row) return "";
  const direct = (row.full_name as string | undefined)?.trim();
  if (direct) return direct;
  const parts = [row.fn, row.mn, row.ln]
    .map((p) => String(p || "").trim())
    .filter(Boolean);
  return parts.join(" ");
}

/**
 * Resolve display names for a set of employee ids in one shot. Returns a
 * `Map<id, displayName>` falling back to the raw id when an employee row
 * is missing so the UI never renders an empty cell.
 */
async function hydrateEmployeeNames(
  ids: string[],
  ctx: PayoutServiceContext
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = Array.from(new Set((ids || []).filter((x) => !!x)));
  if (!unique.length) return map;
  const rows = await employeeRepository.findByIds(unique, dbAccess(ctx));
  if (rows.success && Array.isArray(rows.data)) {
    for (const row of rows.data) {
      const id = String(row.id || "");
      if (!id) continue;
      const name = composeEmployeeName(row);
      map.set(id, name || id);
    }
  }
  // Fill in missing ids so callers can always read from the map.
  for (const id of unique) {
    if (!map.has(id)) map.set(id, id);
  }
  return map;
}

function emptyDiagnostics(): PayoutDiagnostics {
  return {
    charge_row_count: 0,
    charge_sum: 0,
    charge_zero_rate_rows: 0,
    charge_distinct_svc_keys: 0,
    charge_last_updated_at: null,
    duty_row_count: 0,
    duty_statuses: {},
    attendance_row_count: 0,
    attendance_payable_count: 0,
    attendance_payable_hours: 0,
    warning: "",
    duties_needing_rate: []
  };
}

function payoutHoursForTerm(value: unknown): number {
  const text = String(value || "").toLowerCase();
  if (!text) return 24;
  if (text.includes("24")) return 24;
  if (text.includes("night") || text.includes("8:00 pm") || text.includes("8 pm")) return 12;
  if (text.includes("day") || text.includes("9:00 am") || text.includes("9 am")) return 10;
  return 24;
}

/**
 * Inspect the three tables that feed a payout (`hh_payout_charges`,
 * `hh_duties`, `hh_attendance`) and produce row counts + a human-readable
 * warning when the data flow looks broken.
 *
 * The most common failure modes we surface:
 *   1. Duties exist but every charge row has amount = 0 → the duty was
 *      saved with `payout_per_day = 0`. Operator must edit the duty.
 *   2. Duties exist but NO charge rows exist → materialization never ran
 *      (legacy duty, or save without `materialize: true`). Pressing
 *      "Recompute" will fix this because we now re-materialize first.
 *   3. Attendance is intentionally not used for payout totals. The duty
 *      calendar materialized charge rows are the single payout source.
 */
function buildDiagnostics(
  duties: JsonRow[],
  attendance: JsonRow[],
  charges: JsonRow[],
  zeroRateDuties: JsonRow[] = []
): PayoutDiagnostics {
  const diagnostics = emptyDiagnostics();
  diagnostics.duty_row_count = duties.length;
  for (const d of duties) {
    const status = String(d.status || "").toUpperCase() || "UNKNOWN";
    diagnostics.duty_statuses[status] = (diagnostics.duty_statuses[status] || 0) + 1;
  }

  diagnostics.duties_needing_rate = zeroRateDuties.map((d) => ({
    duty_id: String(d.id || ""),
    patient_id: (d.patient_id as string | null) ?? null,
    service_name: (d.service_name as string | null) ?? null,
    start_at: (d.start_at as string | null) ?? null,
    end_at: (d.end_at as string | null) ?? null,
    status: (d.status as string | null) ?? null,
    charge_per_day: Number(d.charge_per_day || 0),
    payout_per_day: Number(d.payout_per_day || 0)
  }));

  diagnostics.attendance_row_count = attendance.length;
  diagnostics.attendance_payable_count = 0;
  diagnostics.attendance_payable_hours = 0;

  diagnostics.charge_row_count = charges.length;
  const svcKeys = new Set<string>();
  let sum = 0;
  let zero = 0;
  let lastUpdated = "";
  for (const c of charges) {
    const amount = Number(c.amount || 0);
    sum += amount;
    if (amount <= 0) zero += 1;
    const key = String(c.svc_key || "");
    if (key) svcKeys.add(key);
    const updated = String(c.updated_at || c.created_at || "");
    if (updated && updated > lastUpdated) lastUpdated = updated;
  }
  diagnostics.charge_sum = roundMoney(sum);
  diagnostics.charge_zero_rate_rows = zero;
  diagnostics.charge_distinct_svc_keys = svcKeys.size;
  diagnostics.charge_last_updated_at = lastUpdated || null;

  const activeDutyCount = duties.filter((d) => {
    const status = String(d.status || "").toUpperCase();
    return status !== "CANCELLED" && status !== "NO_SHOW";
  }).length;

  if (diagnostics.duties_needing_rate.length > 0) {
    diagnostics.warning =
      `${diagnostics.duties_needing_rate.length} duty/duties for this employee have payout_per_day = 0 — set a rate below and the payout will refresh automatically.`;
  } else if (activeDutyCount > 0 && diagnostics.charge_row_count === 0) {
    diagnostics.warning =
      "Duties exist for this employee in this period but no payout charges have been materialized. Press Recompute to refresh.";
  } else if (
    diagnostics.charge_row_count > 0 &&
    diagnostics.charge_sum === 0
  ) {
    diagnostics.warning =
      "Payout charges exist but every row has amount ₹0. Open the source duty and set a non-zero payout_per_day, then Recompute.";
  } else if (activeDutyCount === 0 && diagnostics.charge_row_count === 0) {
    diagnostics.warning =
      "No duties or charges for this employee in this period. Assign them on the duty calendar first.";
  }

  return diagnostics;
}

/**
 * Build a per-patient summary for a (employee, period) payout.
 *
 * Strategy:
 *   1. Walk duties → map duty_id → patient_id, collect patient ids.
 *   2. Walk charges → parse `duty:<id>:...` from remarks → look up the
 *      duty's patient. Sum amount per patient, count distinct dates,
 *      track first/last date.
 *   3. Hydrate patient names in one batch lookup so the UI / PDF can
 *      print "Mr. Patel — 22 days · ₹17,600" without an N+1.
 */
async function buildPatientBreakdown(
  duties: JsonRow[],
  _attendance: JsonRow[],
  charges: JsonRow[],
  ctx: PayoutServiceContext
): Promise<PayoutPatientSummary[]> {
  const dutyToPatient = new Map<string, string>();
  for (const d of duties) {
    const id = String(d.id || "");
    const pid = String(d.patient_id || "");
    if (id && pid) dutyToPatient.set(id, pid);
  }

  type Acc = {
    patient_id: string;
    amount: number;
    days: Set<string>;
    duty_ids: Set<string>;
    first_date: string | null;
    last_date: string | null;
    days_worked: number;
    hours: number;
  };
  const byPatient = new Map<string, Acc>();
  const ensure = (pid: string): Acc => {
    let acc = byPatient.get(pid);
    if (!acc) {
      acc = {
        patient_id: pid,
        amount: 0,
        days: new Set(),
        duty_ids: new Set(),
        first_date: null,
        last_date: null,
        days_worked: 0,
        hours: 0
      };
      byPatient.set(pid, acc);
    }
    return acc;
  };

  for (const c of charges) {
    const parsed = parseDutyDiaryRemarks(String(c.remarks || ""));
    if (!parsed) continue;
    const pid = dutyToPatient.get(parsed.dutyId);
    if (!pid) continue;
    const acc = ensure(pid);
    acc.amount += Number(c.amount || 0);
    acc.duty_ids.add(parsed.dutyId);
    const date = String(c.date || parsed.isoDate || "").slice(0, 10);
    if (date) {
      acc.days.add(date);
      acc.hours += payoutHoursForTerm(c.term || c.freq || c.service_term);
      if (!acc.first_date || date < acc.first_date) acc.first_date = date;
      if (!acc.last_date || date > acc.last_date) acc.last_date = date;
    }
  }

  // Also make sure every duty's patient appears in the breakdown even when
  // no charges/attendance exist yet — otherwise "this duty had no
  // materialization" cases would hide the patient entirely.
  for (const [, pid] of dutyToPatient) {
    ensure(pid);
  }

  const patientIds = Array.from(byPatient.keys());
  const nameMap = new Map<string, string>();
  if (patientIds.length) {
    const rows = await patientRepository.findByIds(patientIds, dbAccess(ctx));
    if (rows.success && Array.isArray(rows.data)) {
      for (const row of rows.data) {
        const id = String(row.id || "");
        if (!id) continue;
        const direct = String(row.full_name || row.name || "").trim();
        if (direct) {
          nameMap.set(id, direct);
          continue;
        }
        const parts = [row.fn, row.mn, row.ln]
          .map((p) => String(p || "").trim())
          .filter(Boolean);
        nameMap.set(id, parts.join(" ") || id);
      }
    }
  }

  return Array.from(byPatient.values())
    .map<PayoutPatientSummary>((acc) => ({
      patient_id: acc.patient_id,
      patient_name: nameMap.get(acc.patient_id) || acc.patient_id,
      days_worked: acc.days.size,
      hours: Math.round(acc.hours * 100) / 100,
      charged_days: acc.days.size,
      amount: roundMoney(acc.amount),
      first_date: acc.first_date,
      last_date: acc.last_date,
      duty_ids: Array.from(acc.duty_ids)
    }))
    .sort((a, b) => b.amount - a.amount || b.days_worked - a.days_worked);
}

function validatePayoutDetailContract(detail: PayoutDetail): PayoutDetail {
  const parsed = parsePayoutDetailDto(detail);
  if (!parsed.success && process.env.NODE_ENV !== "production") {
    console.warn(
      "[payoutService] PayoutDetailDTO contract mismatch",
      parsed.error.flatten()
    );
  }
  return detail;
}

function payoutDetailPermissions(
  payout: JsonRow,
  outstanding: number,
  dutyCount: number
): PayoutPermissionsDto {
  return buildPayoutPermissions({
    status: String(payout.status || "OPEN"),
    outstanding,
    netAmount: Number(payout.net_amount || 0),
    dutyCount
  });
}

/** Load a payout + its source duty/attendance for the breakdown widget. */
async function loadPayoutDetail(
  payout: JsonRow,
  ctx: PayoutServiceContext
): Promise<ApiResult<PayoutDetail>> {
  const employeeId = String(payout.employee_id || "");
  const period = String(payout.period_month || "");
  const nameMap = await hydrateEmployeeNames(employeeId ? [employeeId] : [], ctx);
  const employeeName = nameMap.get(employeeId) || employeeId;

  if (!employeeId || !period) {
    const outstanding = Math.max(0, Number(payout.net_amount || 0));
    return success(
      validatePayoutDetailContract({
        payout: { ...payout, employee_name: employeeName },
        duties: [],
        attendance: [],
        breakdown: [],
        paid_transactions: [],
        paid_total: 0,
        outstanding,
        employee_name: employeeName,
        patient_breakdown: [],
        diagnostics: emptyDiagnostics(),
        permissions: payoutDetailPermissions(payout, outstanding, 0)
      })
    );
  }

  const access = dbAccess(ctx);
  const { startISO, endISO } = monthRangeUTC(period);

  const [duties, attendance, paidTx, charges, zeroRate] = await Promise.all([
    dutyRepository.list(
      { employeeId, from: startISO, to: endISO, limit: 500, offset: 0 },
      access
    ),
    attendanceRepository.listForEmployeeMonth(employeeId, startISO, endISO, access),
    payoutRepository.listPaidTransactionsByPayout(String(payout.id || ""), access),
    payoutRepository.listChargesByEmployeePeriod(employeeId, period, access),
    dutyRepository.findZeroPayoutRateForEmployeePeriod(employeeId, period, access)
  ]);
  if (!duties.success) return passFailure(duties);
  if (!attendance.success) return passFailure(attendance);
  if (!paidTx.success) return passFailure(paidTx);
  if (!charges.success) return passFailure(charges);
  if (!zeroRate.success) return passFailure(zeroRate);

  const dutyRows = duties.data?.rows || [];
  const attendanceRows = attendance.data || [];
  const paidRows = paidTx.data || [];
  const chargeRows = charges.data || [];
  const zeroRateRows = zeroRate.data || [];
  const diagnostics = buildDiagnostics(
    dutyRows,
    attendanceRows,
    chargeRows,
    zeroRateRows
  );
  const patientBreakdown = await buildPatientBreakdown(
    dutyRows,
    attendanceRows,
    chargeRows,
    ctx
  );
  const paidTotal = paidRows.reduce(
    (sum, r) => sum + Number(r.amount || 0),
    0
  );
  const outstanding = Math.max(0, Number(payout.net_amount || 0) - paidTotal);
  const dutyCount = Math.max(
    Number(payout.duty_count || 0),
    diagnostics.charge_row_count
  );

  return success(
    validatePayoutDetailContract({
      payout: { ...payout, employee_name: employeeName },
      duties: dutyRows,
      attendance: attendanceRows,
      paid_transactions: paidRows,
      paid_total: roundMoney(paidTotal),
      outstanding: roundMoney(outstanding),
      employee_name: employeeName,
      patient_breakdown: patientBreakdown,
      diagnostics,
      permissions: payoutDetailPermissions(
        payout,
        roundMoney(outstanding),
        dutyCount
      ),
      // Legacy `breakdown` mirrors patient_breakdown so consumers never see
      // divergent day counts (PRESENT-only vs PRESENT/LATE/HALF_DAY).
      breakdown: patientBreakdown.map((p) => ({
        patient_id: p.patient_id,
        duty_count: p.charged_days,
        hours: p.hours,
        duty_ids: p.duty_ids
      }))
    })
  );
}

/**
 * Run `hh_recompute_payout` for an (employee, period) pair, refetch the row,
 * apply any caller-supplied adjustments, and return the persisted result.
 *
 * If the RPC reports zero duties + zero hours and the caller hasn't requested
 * a `force`, refuse loudly so the UI surfaces a "no data for period" error
 * instead of silently creating a ₹0 row.
 */
async function recomputeAndPersist(
  employeeId: string,
  period: string,
  ctx: PayoutServiceContext,
  options: {
    adjustments?: Partial<{
      advance: number;
      deduction: number;
      bonus: number;
      remarks: string;
    }>;
    requireSource?: boolean;
    /**
     * When true (the default for ensure/recompute), re-materialize every duty
     * involving this employee×period BEFORE summing `hh_payout_charges`. This
     * guarantees that edits to duty rates or partner assignments flow into
     * the payout without the user having to also open each duty manually.
     * Set false for cron / billing-close paths that have already materialized.
     */
    rematerialize?: boolean;
  } = {}
): Promise<ApiResult<JsonRow>> {
  const access = dbAccess(ctx);

  if (options.rematerialize !== false) {
    // Soft pass — failures here are logged inside the report.failures array
    // and surfaced via diagnostics but never block the recompute itself
    // (we still want a payout row even if one of N duties had no active bill).
    const rematerialize = await dutyDiaryService.rematerializeForEmployeePeriod(
      employeeId,
      period,
      ctx
    );
    if (!rematerialize.success) {
      console.warn(
        "[payoutService.recomputeAndPersist] rematerialize failed",
        { employeeId, period, error: rematerialize.error }
      );
    }
  }

  const rpc = await payoutRepository.recomputeRpc(employeeId, period, access);
  if (!rpc.success) return passFailure(rpc);
  const payoutId = rpc.data?.payout_id;
  if (!payoutId) {
    return failure(
      "hh_recompute_payout returned no payout_id",
      ErrorCodes.internal,
      { employee_id: employeeId, period }
    );
  }

  if (options.requireSource ?? true) {
    const dutyCount = Number(rpc.data?.duties || 0);
    const hours = Number(rpc.data?.hours || 0);
    const sourceCheck = ensurePayoutHasSource(dutyCount, hours);
    if (!sourceCheck.success) {
      return failure(
        sourceCheck.error || "No source data for payout",
        sourceCheck.code,
        sourceCheck.details
      );
    }
  }

  const row = await payoutRepository.findById(payoutId, access);
  if (!row.success) return passFailure(row);
  if (!row.data) return notFoundFailure("Payout", payoutId);

  const adj = options.adjustments;
  if (!adj || (adj.advance === undefined && adj.deduction === undefined && adj.bonus === undefined && adj.remarks === undefined)) {
    return success(row.data);
  }

  const rowData = row.data;
  const merged = mergePayoutAdjustments(
    {
      gross_amount: rowData.gross_amount as number | string | null | undefined,
      advance: rowData.advance as number | string | null | undefined,
      deduction: rowData.deduction as number | string | null | undefined,
      bonus: rowData.bonus as number | string | null | undefined,
      remarks: (rowData.remarks as string | null) ?? ""
    },
    adj
  );
  const sanity = validatePayoutAmounts(
    Number(rowData.gross_amount || 0),
    merged.advance,
    merged.deduction,
    merged.bonus
  );
  if (!sanity.success) {
    return failure(sanity.error || "Invalid amounts", sanity.code, sanity.details);
  }

  const patch = {
    advance: merged.advance,
    deduction: merged.deduction,
    bonus: merged.bonus,
    remarks: merged.remarks,
    net_amount: merged.net_amount,
    updated_by: ctx.actor.email
  };
  const updated = await payoutRepository.update(payoutId, patch, access);
  if (!updated.success) return passFailure(updated);

  const fresh = await loadFreshPayout(payoutId, ctx, updated.data ?? null);
  if (!fresh.success) {
    return failure(fresh.error || "Refetch failed", fresh.code, fresh.details);
  }
  return success(fresh.data);
}

export const payoutService = {
  // ─────────────────────────────────────────────────────────────────────
  // Reads
  // ─────────────────────────────────────────────────────────────────────

  async list(
    rawQuery: unknown,
    ctx: PayoutServiceContext
  ): Promise<ApiResult<{ rows: JsonRow[]; total: number }>> {
    const parsed = parseInput(payoutListQuerySchema, rawQuery);
    if (!parsed.success) return passFailure(parsed);
    const query = parsed.data as PayoutListQuery;

    const result = await payoutRepository.list(
      {
        limit: query.limit,
        offset: query.offset,
        q: query.q,
        employeeId: query.employee_id,
        status: query.status,
        period: query.period
      },
      dbAccess(ctx)
    );
    if (!result.success) return passFailure(result);
    const rows = result.data?.rows || [];
    // Hydrate display names in a single batch so the UI doesn't have to
    // join against `/lookups/employees` row-by-row.
    const names = await hydrateEmployeeNames(
      rows.map((r) => String(r.employee_id || "")),
      ctx
    );
    const hydrated = rows.map((r) => ({
      ...r,
      employee_name:
        names.get(String(r.employee_id || "")) || String(r.employee_id || "")
    }));
    return success({ rows: hydrated, total: result.data?.total ?? 0 });
  },

  async getById(id: string, ctx: PayoutServiceContext): Promise<ApiResult<PayoutDetail>> {
    const loaded = await loadPayout(id, ctx);
    if (!loaded.success) {
      return failure(loaded.error || "Payout not found", loaded.code, loaded.details);
    }
    return loadPayoutDetail(loaded.data, ctx);
  },

  /**
   * Period-scoped roster of employees who still have unpaid balances.
   *
   * Sourced from the duty calendar (`hh_payout_charges`) minus
   * `hh_paid_transactions` via `hh_employees_pending_for_period` (migration
   * 043). Each row is enriched with the employee display name and any
   * existing `hh_payouts` row (id + status) so the UI can show "ensure /
   * open payout" actions without an extra round-trip.
   */
  async pendingEmployeesForPeriod(
    rawQuery: unknown,
    ctx: PayoutServiceContext
  ): Promise<
    ApiResult<{
      period: string;
      rows: Array<{
        employee_id: string;
        employee_name: string;
        charged: number;
        paid: number;
        pending: number;
        duty_count: number;
        payout_id: string | null;
        payout_status: string | null;
      }>;
      total_pending: number;
      source: "rpc" | "fallback";
    }>
  > {
    const period = String(
      (rawQuery && typeof rawQuery === "object"
        ? (rawQuery as { period?: unknown }).period
        : "") || ""
    ).trim();
    if (!/^\d{4}-\d{2}$/.test(period)) {
      return failure(
        "period must be in YYYY-MM format",
        ErrorCodes.validation,
        { period }
      );
    }
    const query = { period };
    const access = dbAccess(ctx);

    type AggRow = {
      employee_id: string;
      charged: number;
      paid: number;
      pending: number;
      duty_count: number;
    };
    let rpcRows: AggRow[] = [];
    let source: "rpc" | "fallback" = "rpc";
    const rpc = await payoutRepository.pendingEmployeesForPeriodRpc(
      query.period,
      access
    );
    if (rpc.success) {
      rpcRows = (rpc.data || []).map((r) => ({
        employee_id: String(r.employee_id || ""),
        charged: Number(r.charged || 0),
        paid: Number(r.paid || 0),
        pending: Number(r.pending || 0),
        duty_count: Number(r.duty_count || 0)
      }));
    } else {
      // Graceful fallback: the aggregating RPC (migration 043) may not be
      // applied yet. Reconstruct the same shape from hh_payout_charges +
      // hh_paid_transactions so the operator never sees an empty board just
      // because a SQL migration hasn't shipped.
      console.warn(
        "[payoutService.pendingEmployeesForPeriod] RPC failed, falling back to direct table query",
        { period, error: rpc.error }
      );
      source = "fallback";
      const [chargesAll, paidAll] = await Promise.all([
        payoutRepository.listAllChargesForPeriod(query.period, access),
        payoutRepository.listAllPaidTransactionsForPeriod(query.period, access)
      ]);
      if (!chargesAll.success) return passFailure(chargesAll);
      if (!paidAll.success) return passFailure(paidAll);
      const chargeBy = new Map<string, { charged: number; duties: Set<string> }>();
      for (const row of chargesAll.data || []) {
        const empId =
          String((row.partner_id as string | null) || "") ||
          String((row.partner as string | null) || "");
        if (!empId) continue;
        const slot = chargeBy.get(empId) || { charged: 0, duties: new Set<string>() };
        slot.charged += Number(row.amount || 0);
        const dutyId = String((row.duty_id as string | null) || "");
        if (dutyId) slot.duties.add(dutyId);
        chargeBy.set(empId, slot);
      }
      const paidBy = new Map<string, number>();
      for (const row of paidAll.data || []) {
        const empId =
          String((row.employee_id as string | null) || "") ||
          String((row.partner as string | null) || "");
        if (!empId) continue;
        paidBy.set(empId, (paidBy.get(empId) || 0) + Number(row.amount || 0));
      }
      const allEmployees = new Set<string>([...chargeBy.keys(), ...paidBy.keys()]);
      for (const empId of allEmployees) {
        const charged = chargeBy.get(empId)?.charged ?? 0;
        const paid = paidBy.get(empId) ?? 0;
        const pending = Math.max(0, charged - paid);
        if (pending <= 0.005) continue;
        rpcRows.push({
          employee_id: empId,
          charged,
          paid,
          pending,
          duty_count: chargeBy.get(empId)?.duties.size ?? 0
        });
      }
      rpcRows.sort((a, b) => b.pending - a.pending);
    }

    const ids = rpcRows.map((r) => String(r.employee_id || "")).filter(Boolean);
    const nameMap = await hydrateEmployeeNames(ids, ctx);

    // Pull every existing hh_payouts row for the period so we can light up
    // "Open in payouts" / "Ensure" actions on the board.
    const payoutsForPeriod = await payoutRepository.listByPeriod(query.period, access);
    if (!payoutsForPeriod.success) return passFailure(payoutsForPeriod);
    const payoutByEmployee = new Map<string, { id: string; status: string }>();
    for (const row of payoutsForPeriod.data || []) {
      const empId = String(row.employee_id || "");
      if (!empId) continue;
      payoutByEmployee.set(empId, {
        id: String(row.id || ""),
        status: String(row.status || "OPEN")
      });
    }

    const rows = rpcRows.map((r) => {
      const id = String(r.employee_id || "");
      const existing = payoutByEmployee.get(id) || null;
      return {
        employee_id: id,
        employee_name: nameMap.get(id) || id,
        charged: Number(r.charged || 0),
        paid: Number(r.paid || 0),
        pending: Number(r.pending || 0),
        duty_count: Number(r.duty_count || 0),
        payout_id: existing ? existing.id : null,
        payout_status: existing ? existing.status : null
      };
    });

    const totalPending = rows.reduce((sum, r) => sum + Number(r.pending || 0), 0);
    void query;
    return success({
      period,
      rows,
      total_pending: roundMoney(totalPending),
      source
    });
  },

  /** Lookup by natural key (employee + period) — used by duty / attendance services. */
  async getByEmployeePeriod(
    employeeId: string,
    period: string,
    ctx: PayoutServiceContext
  ): Promise<ApiResult<JsonRow | null>> {
    return payoutRepository.findByEmployeePeriod(employeeId, period, dbAccess(ctx));
  },

  /**
   * Period-scoped "pending payout" for an employee — sourced directly from
   * the duty calendar (`hh_payout_charges`) minus disbursements already
   * recorded in `hh_paid_transactions`. Works even before an `hh_payouts`
   * row exists, so the duty calendar can render the pending pill before
   * the accountant clicks "Ensure payout".
   *
   * Also returns the persisted `hh_payouts` row (if any), the list of
   * disbursements for the period, and the employee name so the UI can
   * render the panel with one round-trip.
   */
  async pendingForEmployeePeriod(
    rawQuery: unknown,
    ctx: PayoutServiceContext
  ): Promise<
    ApiResult<{
      employee_id: string;
      employee_name: string;
      period: string;
      charged: number;
      paid: number;
      pending: number;
      duty_count: number;
      hours: number;
      payout: JsonRow | null;
      paid_transactions: JsonRow[];
    }>
  > {
    const parsed = parseInput(payoutPendingQuerySchema, rawQuery);
    if (!parsed.success) return passFailure(parsed);
    const query = parsed.data as PayoutPendingQuery;
    const access = dbAccess(ctx);

    // Single source of truth: the live "pending from duty calendar" number is
    // read through the central duty-ledger authority (same function the Duty
    // Calendar totals use), so the two screens can never disagree.
    const { getEmployeePayoutLedger } = await import("@/src/lib/duty-ledger");
    const [ledger, existing, paidTx, nameMap] = await Promise.all([
      getEmployeePayoutLedger(query.employee_id, query.period, access),
      payoutRepository.findByEmployeePeriod(query.employee_id, query.period, access),
      payoutRepository.listPaidTransactionsByEmployeePeriod(
        query.employee_id,
        query.period,
        access
      ),
      hydrateEmployeeNames([query.employee_id], ctx)
    ]);
    if (!ledger.success) return passFailure(ledger);
    if (!existing.success) return passFailure(existing);
    if (!paidTx.success) return passFailure(paidTx);

    return success({
      employee_id: query.employee_id,
      employee_name: nameMap.get(query.employee_id) || query.employee_id,
      period: query.period,
      charged: Number(ledger.data?.gross || 0),
      paid: Number(ledger.data?.paid || 0),
      pending: Number(ledger.data?.outstanding || 0),
      duty_count: Number(ledger.data?.duty_count || 0),
      hours: Number(ledger.data?.hours || 0),
      payout: existing.data ?? null,
      paid_transactions: paidTx.data || []
    });
  },

  // ─────────────────────────────────────────────────────────────────────
  // Writes
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Idempotent "ensure" — runs `hh_recompute_payout` and applies caller
   * adjustments. Returns the persisted row. Duplicate prevention is enforced
   * by the DB unique constraint via `recomputeRpc` which upserts.
   */
  async ensure(
    rawInput: unknown,
    ctx: PayoutServiceContext
  ): Promise<ApiResult<JsonRow>> {
    const parsed = parseInput(payoutSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as PayoutInput;

    // Surface early if the same employee+period row is locked.
    const existing = await payoutRepository.findByEmployeePeriod(
      input.employee_id,
      input.period_month,
      dbAccess(ctx)
    );
    if (!existing.success) return passFailure(existing);
    if (existing.data) {
      const editGuard = canEditPayout(String(existing.data.status || ""));
      if (!editGuard.success) {
        return failure(
          editGuard.error || "Payout is locked",
          editGuard.code,
          editGuard.details
        );
      }
    }

    const persisted = await recomputeAndPersist(input.employee_id, input.period_month, ctx, {
      adjustments: {
        advance: input.advance,
        deduction: input.deduction,
        bonus: input.bonus,
        remarks: input.remarks
      },
      requireSource: false // ensure-only path may run before duties have hours
    });
    if (!persisted.success) {
      const msg = (persisted.error || "").toLowerCase();
      if (msg.includes("hh_payouts_unique") || msg.includes("duplicate key value")) {
        return duplicateFailure(
          "employee_period",
          `${input.employee_id}|${input.period_month}`,
          "Payout already exists for this employee + period"
        );
      }
      return passFailure(persisted);
    }

    const persistedData = persisted.data as JsonRow;
    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: String(persistedData.id),
        action: existing.data ? "update" : "create",
        before: existing.data ?? null,
        after: persistedData,
        stamp: `Recompute + ensure for ${input.employee_id} ${input.period_month}`
      }),
      persistedData
    );
  },

  /** Recompute an existing payout from duty + attendance. Idempotent. */
  async recompute(
    rawInput: unknown,
    ctx: PayoutServiceContext
  ): Promise<ApiResult<JsonRow>> {
    const parsed = parseInput(payoutRecomputeSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as PayoutRecomputeInput;

    // Guard: don't recompute a PAID row (would change a settled amount).
    const existing = await payoutRepository.findByEmployeePeriod(
      input.employee_id,
      input.period_month,
      dbAccess(ctx)
    );
    if (!existing.success) return passFailure(existing);
    if (existing.data && isPayoutLocked(String(existing.data.status || ""))) {
      return failure(
        "Cannot recompute a LOCKED or PAID payout",
        ErrorCodes.business,
        { status: existing.data.status }
      );
    }

    const result = await recomputeAndPersist(input.employee_id, input.period_month, ctx, {
      requireSource: true
    });
    if (!result.success) return passFailure(result);

    const resultData = result.data as JsonRow;
    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: String(resultData.id),
        action: "update",
        before: existing.data ?? null,
        after: resultData,
        stamp: `Recompute requested`
      }),
      resultData
    );
  },

  /**
   * Apply advance / deduction / bonus / remarks adjustments to an existing
   * payout. Refuses on LOCKED or PAID rows; recomputes `net_amount`.
   */
  async adjust(
    rawInput: unknown,
    ctx: PayoutServiceContext
  ): Promise<ApiResult<JsonRow>> {
    const parsed = parseInput(payoutAdjustmentSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as PayoutAdjustmentInput;

    const existing = await loadPayout(input.payout_id, ctx);
    if (!existing.success) {
      return failure(existing.error || "Payout not found", existing.code, existing.details);
    }

    const editGuard = canEditPayout(String(existing.data.status || ""));
    if (!editGuard.success) {
      return failure(
        editGuard.error || "Cannot adjust payout",
        editGuard.code,
        editGuard.details
      );
    }

    const stale = assertNotStale(
      "Payout",
      existing.data.updated_at,
      input.expected_updated_at
    );
    if (!stale.success) return passFailure(stale);

    const existingData = existing.data;
    const merged = mergePayoutAdjustments(
      {
        gross_amount: existingData.gross_amount as number | string | null | undefined,
        advance: existingData.advance as number | string | null | undefined,
        deduction: existingData.deduction as number | string | null | undefined,
        bonus: existingData.bonus as number | string | null | undefined,
        remarks: (existingData.remarks as string | null) ?? ""
      },
      input
    );
    const sanity = validatePayoutAmounts(
      Number(existingData.gross_amount || 0),
      merged.advance,
      merged.deduction,
      merged.bonus
    );
    if (!sanity.success) {
      return failure(sanity.error || "Invalid amounts", sanity.code, sanity.details);
    }

    const patch = {
      advance: merged.advance,
      deduction: merged.deduction,
      bonus: merged.bonus,
      remarks: merged.remarks,
      net_amount: merged.net_amount,
      updated_by: ctx.actor.email
    };
    const updated = await payoutRepository.update(input.payout_id, patch, dbAccess(ctx));
    if (!updated.success) return passFailure(updated);

    const fresh = await loadFreshPayout(input.payout_id, ctx, updated.data ?? null);
    if (!fresh.success) {
      return failure(fresh.error || "Refetch failed", fresh.code, fresh.details);
    }

    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: input.payout_id,
        action: "update",
        before: existing.data,
        after: fresh.data,
        stamp: "Adjust advance/deduction/bonus"
      }),
      fresh.data
    );
  },

  /** Lock a payout — blocks further adjustments until reopen. */
  async lock(
    id: string,
    rawInput: unknown,
    ctx: PayoutServiceContext
  ): Promise<ApiResult<JsonRow>> {
    const existing = await loadPayout(id, ctx);
    if (!existing.success) {
      return failure(existing.error || "Payout not found", existing.code, existing.details);
    }

    const parsed = parseInput(payoutLockSchema, rawInput ?? {});
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as PayoutLockInput;

    const stale = assertNotStale(
      "Payout",
      existing.data.updated_at,
      input.expected_updated_at
    );
    if (!stale.success) return passFailure(stale);

    const transition = canPayoutTransitionTo(String(existing.data.status || ""), "LOCKED");
    if (!transition.success) {
      return failure(
        transition.error || "Illegal status transition",
        transition.code,
        transition.details
      );
    }
    const lockGuard = canLockPayout(
      String(existing.data.status || ""),
      Number(existing.data.net_amount || 0),
      Number(existing.data.duty_count || 0)
    );
    if (!lockGuard.success) {
      return failure(lockGuard.error || "Cannot lock payout", lockGuard.code, lockGuard.details);
    }

    const patch = payoutLockRow(ctx.actor.email, input.reason);
    const updated = await payoutRepository.update(id, patch, dbAccess(ctx));
    if (!updated.success) return passFailure(updated);

    const fresh = await loadFreshPayout(id, ctx, updated.data ?? null);
    if (!fresh.success) {
      return failure(fresh.error || "Refetch failed", fresh.code, fresh.details);
    }

    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: id,
        action: "close",
        before: existing.data,
        after: fresh.data,
        stamp: `Closed (locked)${input.reason ? `: ${input.reason}` : ""}`
      }),
      fresh.data
    );
  },

  /** Reopen a LOCKED payout. Requires an audited reason. */
  async reopen(
    id: string,
    rawInput: unknown,
    ctx: PayoutServiceContext
  ): Promise<ApiResult<JsonRow>> {
    const existing = await loadPayout(id, ctx);
    if (!existing.success) {
      return failure(existing.error || "Payout not found", existing.code, existing.details);
    }

    const parsed = parseInput(payoutReopenSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as PayoutReopenInput;

    const stale = assertNotStale(
      "Payout",
      existing.data.updated_at,
      input.expected_updated_at
    );
    if (!stale.success) return passFailure(stale);

    const guard = canReopenPayout(String(existing.data.status || ""));
    if (!guard.success) {
      return failure(guard.error || "Cannot reopen payout", guard.code, guard.details);
    }

    const patch = payoutReopenRow(ctx.actor.email, input.reason);
    const updated = await payoutRepository.update(id, patch, dbAccess(ctx));
    if (!updated.success) return passFailure(updated);

    const fresh = await loadFreshPayout(id, ctx, updated.data ?? null);
    if (!fresh.success) {
      return failure(fresh.error || "Refetch failed", fresh.code, fresh.details);
    }

    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: id,
        action: "update",
        before: existing.data,
        after: fresh.data,
        stamp: `Reopened: ${input.reason}`
      }),
      fresh.data
    );
  },

  /**
   * Record the FINAL disbursement against a payout. Flips the payout to
   * PAID once total disbursements settle the net amount.
   *
   * Each call creates a fresh `hh_paid_transactions` row with a unique
   * `PTXYYYY######` serial allocated by `hh_next_paid_tx_serial()` — so a
   * payout that was partially advanced has BOTH rows visible in audit
   * (advance + final).
   *
   * `amount` is optional: if omitted, the service settles the remaining
   * outstanding (net_amount − previously paid). `proof_bucket`/`proof_path`
   * point at a previously-uploaded file in the `payout-proofs` Storage
   * bucket and are mandatory for audit hygiene (the API rejects calls
   * without them on a non-zero amount).
   */
  async markPaid(
    rawInput: unknown,
    ctx: PayoutServiceContext
  ): Promise<ApiResult<JsonRow>> {
    const parsed = parseInput(payoutPaySchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as PayoutPayInput;

    const existing = await loadPayout(input.payout_id, ctx);
    if (!existing.success) {
      return failure(existing.error || "Payout not found", existing.code, existing.details);
    }

    const stalePay = assertNotStale(
      "Payout",
      existing.data.updated_at,
      input.expected_updated_at
    );
    if (!stalePay.success) return passFailure(stalePay);

    const guard = canMarkPayoutPaid(String(existing.data.status || ""));
    if (!guard.success) {
      return failure(guard.error || "Cannot mark paid", guard.code, guard.details);
    }
    const transition = canPayoutTransitionTo(String(existing.data.status || ""), "PAID");
    if (!transition.success) {
      return failure(transition.error || "Illegal transition", transition.code, transition.details);
    }

    const access = dbAccess(ctx);
    const priorTx = await payoutRepository.listPaidTransactionsByPayout(
      input.payout_id,
      access
    );
    if (!priorTx.success) return passFailure(priorTx);
    const paidSoFar = (priorTx.data || []).reduce(
      (sum, r) => sum + Number(r.amount || 0),
      0
    );
    const netAmount = Number(existing.data.net_amount || 0);
    const remaining = Math.max(0, netAmount - paidSoFar);
    const requestedAmount =
      input.amount !== undefined ? Number(input.amount) : remaining;

    if (requestedAmount <= 0) {
      return failure(
        "Payout has no outstanding balance — nothing to pay",
        ErrorCodes.business,
        { net_amount: netAmount, paid_so_far: paidSoFar }
      );
    }

    const guardAmount = ensureWithinPayoutOutstanding(
      netAmount,
      paidSoFar,
      requestedAmount
    );
    if (!guardAmount.success) {
      return failure(
        guardAmount.error || "Amount exceeds outstanding",
        guardAmount.code,
        guardAmount.details
      );
    }

    if (
      requestedAmount > 0 &&
      (!String(input.proof_bucket || "").trim() || !String(input.proof_path || "").trim())
    ) {
      return failure(
        "Payout proof is required — upload a receipt/photo before marking paid",
        ErrorCodes.business
      );
    }

    const paidOnISO = input.paid_on || new Date().toISOString();
    const paidOnDay = paidOnISO.slice(0, 10);

    const serial = await payoutRepository.nextPaidTxSerialRpc(access);
    if (!serial.success) return passFailure(serial);
    const serialNo = String(serial.data || "");

    const paidTxRow = {
      id: newId.paidTx(),
      serial_no: serialNo,
      payout_id: input.payout_id,
      tx_kind: "FINAL" as const,
      partner: existing.data.employee_id,
      employee_id: existing.data.employee_id,
      period_month: existing.data.period_month,
      paid_on: paidOnDay,
      amount: Number(requestedAmount),
      method: input.method || "",
      photo: input.photo || "",
      proof_bucket: input.proof_bucket || null,
      proof_path: input.proof_path || null,
      remarks: input.remarks || "",
      created_by: ctx.actor.email,
      updated_by: ctx.actor.email
    };
    const paidTx = await payoutRepository.insertPaidTransaction(paidTxRow, access);
    if (!paidTx.success) return passFailure(paidTx);

    // Flip the payout to PAID only when total disbursements settle the net.
    const newPaidTotal = paidSoFar + Number(requestedAmount);
    if (isPayoutFullyPaid(netAmount, newPaidTotal)) {
      const patch = payoutPaidRow(ctx.actor.email, paidOnISO);
      const updated = await payoutRepository.update(input.payout_id, patch, access);
      if (!updated.success) return passFailure(updated);
    } else {
      // Refresh updated_by/at on the payout even on partial settle.
      const updated = await payoutRepository.update(
        input.payout_id,
        { updated_by: ctx.actor.email },
        access
      );
      if (!updated.success) return passFailure(updated);
    }

    const fresh = await loadFreshPayout(input.payout_id, ctx);
    if (!fresh.success) {
      return failure(fresh.error || "Refetch failed", fresh.code, fresh.details);
    }

    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: input.payout_id,
        action: "update",
        before: existing.data,
        after: { payout: fresh.data, paid_tx: paidTxRow },
        stamp: isPayoutFullyPaid(netAmount, newPaidTotal)
          ? `Marked PAID (${serialNo}, ₹${requestedAmount.toFixed(2)})`
          : `Final disbursement ${serialNo} ₹${requestedAmount.toFixed(2)} — partial settle pending`
      }),
      fresh.data
    );
  },

  /**
   * Record an ADVANCE disbursement against an OPEN payout. Unlike
   * `markPaid`, this does NOT flip the payout to PAID — the payout stays
   * in workflow so the accountant can keep recompiling charges, then issue
   * the final disbursement later.
   *
   * Mirrors `markPaid` for amount validation, proof requirement, and
   * serial allocation.
   */
  async payAdvance(
    rawInput: unknown,
    ctx: PayoutServiceContext
  ): Promise<ApiResult<JsonRow>> {
    const parsed = parseInput(payoutAdvanceSchema, rawInput);
    if (!parsed.success) return passFailure(parsed);
    const input = parsed.data as PayoutAdvanceInput;

    const existing = await loadPayout(input.payout_id, ctx);
    if (!existing.success) {
      return failure(existing.error || "Payout not found", existing.code, existing.details);
    }

    const staleAdvance = assertNotStale(
      "Payout",
      existing.data.updated_at,
      input.expected_updated_at
    );
    if (!staleAdvance.success) return passFailure(staleAdvance);

    const guard = canPayAdvance(String(existing.data.status || ""));
    if (!guard.success) {
      return failure(guard.error || "Cannot pay advance", guard.code, guard.details);
    }

    const access = dbAccess(ctx);
    const priorTx = await payoutRepository.listPaidTransactionsByPayout(
      input.payout_id,
      access
    );
    if (!priorTx.success) return passFailure(priorTx);
    const paidSoFar = (priorTx.data || []).reduce(
      (sum, r) => sum + Number(r.amount || 0),
      0
    );
    const netAmount = Number(existing.data.net_amount || 0);
    const guardAmount = ensureWithinPayoutOutstanding(
      netAmount,
      paidSoFar,
      Number(input.amount)
    );
    if (!guardAmount.success) {
      return failure(
        guardAmount.error || "Amount exceeds outstanding",
        guardAmount.code,
        guardAmount.details
      );
    }

    if (!String(input.proof_bucket || "").trim() || !String(input.proof_path || "").trim()) {
      return failure(
        "Payout proof is required — upload a receipt/photo before paying advance",
        ErrorCodes.business
      );
    }

    const serial = await payoutRepository.nextPaidTxSerialRpc(access);
    if (!serial.success) return passFailure(serial);
    const serialNo = String(serial.data || "");

    const paidOnISO = input.paid_on || new Date().toISOString();
    const paidTxRow = {
      id: newId.paidTx(),
      serial_no: serialNo,
      payout_id: input.payout_id,
      tx_kind: "ADVANCE" as const,
      partner: existing.data.employee_id,
      employee_id: existing.data.employee_id,
      period_month: existing.data.period_month,
      paid_on: paidOnISO.slice(0, 10),
      amount: Number(input.amount),
      method: input.method || "",
      photo: input.photo || "",
      proof_bucket: input.proof_bucket || null,
      proof_path: input.proof_path || null,
      remarks: input.remarks || "",
      created_by: ctx.actor.email,
      updated_by: ctx.actor.email
    };
    const paidTx = await payoutRepository.insertPaidTransaction(paidTxRow, access);
    if (!paidTx.success) return passFailure(paidTx);

    // Refresh updated_by/at on the payout so list views reflect the change.
    const touched = await payoutRepository.update(
      input.payout_id,
      { updated_by: ctx.actor.email },
      access
    );
    if (!touched.success) return passFailure(touched);

    const fresh = await loadFreshPayout(input.payout_id, ctx);
    if (!fresh.success) {
      return failure(fresh.error || "Refetch failed", fresh.code, fresh.details);
    }

    return finalizeWithAudit(
      await fireAudit(ctx, {
        entity_id: input.payout_id,
        action: "update",
        before: existing.data,
        after: { payout: fresh.data, paid_tx: paidTxRow },
        stamp: `Advance disbursement ${serialNo} ₹${Number(input.amount).toFixed(2)}`
      }),
      fresh.data
    );
  },

  /**
   * Disabled — Duty Calendar is the single source of truth for payout charges.
   */
  async replacePayoutCharges(
    _rawInput: unknown,
    _ctx: PayoutServiceContext
  ): Promise<ApiResult<{ svc_key: string; count: number }>> {
    return dutyCalendarSotFailure(DUTY_CALENDAR_LEDGER_REPLACE_DISABLED_MESSAGE);
  },

  // ─────────────────────────────────────────────────────────────────────
  // Sync hooks (called by duty / attendance services)
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Recompute by raw natural key — bypasses validation so duty / attendance
   * services can call it cheaply from their own audit-wrapped flows.
   *
   * Returns success even if the row doesn't exist yet (the RPC will upsert).
   * Refuses to touch LOCKED or PAID rows.
   */
  /**
   * One-click repair for "duty exists but Gross is ₹0" — set
   * `payout_per_day` on every zero-rate duty for an (employee, period) pair,
   * re-materialize the diary, then recompute the payout. Returns the
   * refreshed payout detail so the UI can render the corrected total in
   * place.
   *
   * RBAC: callers must hold PAYOUT_WRITE_ROLES (enforced by the route).
   * Refuses if the payout is already PAID — settled amounts are immutable.
   */
  async setEmployeePeriodPayoutRate(
    rawInput: unknown,
    ctx: PayoutServiceContext
  ): Promise<ApiResult<PayoutDetail>> {
    const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as {
      employee_id?: unknown;
      period?: unknown;
      payout_per_day?: unknown;
    };
    const employeeId = String(input.employee_id || "").trim();
    const period = String(input.period || "").trim();
    const rate = Number(input.payout_per_day);
    if (!employeeId) {
      return failure("employee_id is required", ErrorCodes.validation);
    }
    if (!/^\d{4}-\d{2}$/.test(period)) {
      return failure("period must be YYYY-MM", ErrorCodes.validation, { period });
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      return failure(
        "payout_per_day must be a positive number",
        ErrorCodes.validation,
        { payout_per_day: input.payout_per_day }
      );
    }

    const access = dbAccess(ctx);
    const existing = await payoutRepository.findByEmployeePeriod(employeeId, period, access);
    if (existing.success && existing.data && isPayoutLocked(String(existing.data.status || ""))) {
      return failure(
        "Cannot adjust rates on a LOCKED or PAID payout — reopen first",
        ErrorCodes.business,
        { payout_id: existing.data.id, status: existing.data.status }
      );
    }

    const bulk = await dutyRepository.bulkSetPayoutRateForEmployeePeriod(
      employeeId,
      period,
      rate,
      ctx.actor.email,
      access
    );
    if (!bulk.success) return passFailure(bulk);
    const updatedIds = bulk.data?.updated_ids || [];

    // Audit the bulk rate change so it is reviewable from /audit-log later.
    await writeMutationAudit(access, ctx.actor, {
      module: "payouts",
      entity_id: existing.data?.id ? String(existing.data.id) : `${employeeId}:${period}`,
      action: "update",
      stamp: new Date().toISOString(),
      before: { duties_updated: 0 },
      after: {
        employee_id: employeeId,
        period,
        payout_per_day: rate,
        duty_ids: updatedIds
      }
    });

    const persisted = await recomputeAndPersist(employeeId, period, ctx, {
      requireSource: false
    });
    if (!persisted.success) return passFailure(persisted);
    return loadPayoutDetail(persisted.data as JsonRow, ctx);
  },

  async recomputeForEmployeePeriod(
    employeeId: string,
    period: string,
    ctx: PayoutServiceContext
  ): Promise<ApiResult<JsonRow | null>> {
    if (!employeeId || !period) return success(null);
    const existing = await payoutRepository.findByEmployeePeriod(employeeId, period, dbAccess(ctx));
    if (
      existing.success &&
      existing.data &&
      isPayoutLocked(String(existing.data.status || ""))
    ) {
      return success(existing.data);
    }
    const result = await recomputeAndPersist(employeeId, period, ctx, { requireSource: false });
    if (!result.success) return passFailure(result);
    return success(result.data as JsonRow);
  },

  // ─────────────────────────────────────────────────────────────────────
  // Report parity
  // ─────────────────────────────────────────────────────────────────────

  async monthlyTotal(
    period: string,
    ctx: PayoutServiceContext
  ): Promise<
    ApiResult<{
      period: string;
      totals: PayoutTotals;
      rowCount: number;
    }>
  > {
    const result = await payoutRepository.sumNetForPeriod(period, dbAccess(ctx));
    if (!result.success) return passFailure(result);
    const rows = result.data?.rows || [];
    return success({
      period,
      totals: sumPayoutTotals(rows),
      rowCount: rows.length
    });
  },

  /** Convenience helper used by tests + UI — same net the service stores. */
  computeNet(row: JsonRow): number {
    return computePayoutNet(
      row.gross_amount as number | string | null | undefined,
      row.advance as number | string | null | undefined,
      row.deduction as number | string | null | undefined,
      row.bonus as number | string | null | undefined
    );
  }
};

export type { PayoutTotals };
