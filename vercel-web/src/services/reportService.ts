/**
 * Report service — corporate-grade dashboard / reports facade.
 *
 * Composes /src/validation/reportValidation + /src/business/reportRules +
 * /src/database/reportRepository.
 *
 * All KPIs and totals are computed server-side from `hh_*` tables. The
 * frontend may only call these endpoints and re-render — it MUST NOT do its
 * own aggregations against Supabase (that's what caused dashboard/records
 * drift before).
 *
 * Filter semantics:
 *   - `period` (YYYY-MM) selects the calendar month window. When omitted,
 *     the current UTC month is used.
 *   - Explicit `from` / `to` ISO timestamps override the period window for
 *     receipt + service + duty queries.
 *   - `patient_id` / `employee_id` / `status` narrow the entity-specific
 *     counters but leave global counters (e.g. `patients_total`) untouched.
 */

import type { ApiResult } from "@/types/common";
import {
  dashboardQuerySchema,
  payrollQuerySchema,
  billingTotalsQuerySchema,
  payoutTotalsQuerySchema,
  profitLossQuerySchema,
  type DashboardQuery,
  type PayrollQuery,
  type BillingTotalsQuery,
  type PayoutTotalsQuery,
  type ProfitLossQuery
} from "@/validation/reportValidation";
import { parseInput } from "@/validation/parseValidation";
import {
  attachAttendanceToPayrollRows,
  aggregatePayrollTotals,
  buildBillingTotals,
  buildDashboardKpis,
  buildPayoutTotals,
  buildProfitLoss,
  monthRangeUTC,
  type BillingTotalsReport,
  type DashboardKpis,
  type DashboardRawCounts,
  type PayoutTotalsReport,
  type ProfitLossReport,
  type PayrollTotals
} from "@/business/reportRules";
import { reportRepository } from "@/database/reportRepository";
import { passFailure, success } from "@/utils/apiResponse";
import type { JsonRow } from "@/database/types";

export interface ActorLike {
  email: string;
  role?: string;
  accessToken?: string;
}

export interface ReportServiceContext {
  actor: ActorLike;
  accessToken?: string;
}

function dbAccess(ctx: ReportServiceContext) {
  const token = ctx.accessToken ?? ctx.actor.accessToken;
  return token ? { accessToken: token } : undefined;
}

interface WindowResolved {
  period: string;
  startISO: string;
  endISO: string;
  /** YYYY-MM-DD boundaries for `hh_svc_entries.date` (text). */
  startYMD: string;
  endYMD: string;
  /** Did the caller override the period window with explicit from/to? */
  customRange: boolean;
}

function resolveWindow(query: {
  period?: string;
  month?: string;
  from?: string;
  to?: string;
}): WindowResolved {
  const monthHint = query.period || query.month || "";
  const monthBase = monthRangeUTC(monthHint);
  const startISO = query.from ?? monthBase.startISO;
  const endISO = query.to ?? monthBase.endISO;
  return {
    period: monthBase.period,
    startISO,
    endISO,
    startYMD: startISO.slice(0, 10),
    endYMD: endISO.slice(0, 10),
    customRange: Boolean(query.from || query.to)
  };
}

/** Helper to unwrap one of N parallel ApiResult repository calls. */
function expect<T>(result: ApiResult<T>, fallback: T): T {
  if (!result.success) return fallback;
  return (result.data as T) ?? fallback;
}

export const reportService = {
  // ─────────────────────────────────────────────────────────────────────
  // Dashboard KPIs
  // ─────────────────────────────────────────────────────────────────────

  async dashboard(
    rawQuery: unknown,
    ctx: ReportServiceContext
  ): Promise<ApiResult<DashboardKpis>> {
    const parsed = parseInput(dashboardQuerySchema, rawQuery ?? {});
    if (!parsed.success) return passFailure(parsed);
    const query = parsed.data as DashboardQuery;
    const w = resolveWindow(query);
    const access = dbAccess(ctx);

    const [
      patientsTotal,
      patientsActive,
      employeesTotal,
      employeesActive,
      inquiries,
      dutiesActive,
      dutiesScheduled,
      dutiesCompleted,
      dutiesCancelled,
      billingsTotal,
      billingsOpen,
      billingsClosed,
      services,
      receipts,
      payouts,
      payoutCharges
    ] = await Promise.all([
      reportRepository.countAllPatients(access),
      reportRepository.countActivePatients(access),
      reportRepository.countAllEmployees(access),
      reportRepository.countActiveEmployees(access),
      reportRepository.countInquiriesInRange(w.startISO, w.endISO, access),
      reportRepository.countDutiesInRange(
        w.startISO,
        w.endISO,
        {
          status: ["SCHEDULED", "IN_PROGRESS"],
          employeeId: query.employee_id,
          patientId: query.patient_id
        },
        access
      ),
      reportRepository.countDutiesInRange(
        w.startISO,
        w.endISO,
        { status: ["SCHEDULED"], employeeId: query.employee_id, patientId: query.patient_id },
        access
      ),
      reportRepository.countDutiesInRange(
        w.startISO,
        w.endISO,
        { status: ["COMPLETED"], employeeId: query.employee_id, patientId: query.patient_id },
        access
      ),
      reportRepository.countDutiesInRange(
        w.startISO,
        w.endISO,
        {
          status: ["CANCELLED", "NO_SHOW"],
          employeeId: query.employee_id,
          patientId: query.patient_id
        },
        access
      ),
      reportRepository.countBillings({ patientId: query.patient_id }, access),
      reportRepository.countBillings({ status: "Active", patientId: query.patient_id }, access),
      reportRepository.countBillings({ status: "Closed", patientId: query.patient_id }, access),
      reportRepository.listServicesInRange(
        w.startYMD,
        w.endYMD,
        { patient_id: query.patient_id },
        access
      ),
      reportRepository.listReceiptsInRange(
        w.startISO,
        w.endISO,
        { patient_id: query.patient_id },
        access
      ),
      reportRepository.listPayoutsForPeriod(
        w.period,
        { employee_id: query.employee_id, status: query.status },
        access
      ),
      reportRepository.listPayoutChargesInRange(
        w.startYMD,
        w.endYMD,
        { partner_id: query.employee_id },
        access
      )
    ]);

    const raw: DashboardRawCounts = {
      patients_total: expect(patientsTotal, 0),
      patients_active: expect(patientsActive, 0),
      employees_total: expect(employeesTotal, 0),
      employees_active: expect(employeesActive, 0),
      inquiries_this_month: expect(inquiries, 0),
      duties_active: expect(dutiesActive, 0),
      duties_scheduled: expect(dutiesScheduled, 0),
      duties_completed: expect(dutiesCompleted, 0),
      duties_cancelled: expect(dutiesCancelled, 0),
      billings_total: expect(billingsTotal, 0),
      billings_open: expect(billingsOpen, 0),
      billings_closed: expect(billingsClosed, 0),
      service_rows: castRows(services),
      receipt_rows: castRows(receipts),
      payout_rows: castRows(payouts),
      payout_charge_rows: castRows(payoutCharges)
    };

    return success(
      buildDashboardKpis(w.period, { from: w.startISO, to: w.endISO }, raw)
    );
  },

  // ─────────────────────────────────────────────────────────────────────
  // Billing totals (filtered)
  // ─────────────────────────────────────────────────────────────────────

  async billingTotals(
    rawQuery: unknown,
    ctx: ReportServiceContext
  ): Promise<ApiResult<BillingTotalsReport>> {
    const parsed = parseInput(billingTotalsQuerySchema, rawQuery ?? {});
    if (!parsed.success) return passFailure(parsed);
    const query = parsed.data as BillingTotalsQuery;
    const w = resolveWindow(query);
    const access = dbAccess(ctx);

    const [billings, services, receipts] = await Promise.all([
      reportRepository.listBillingsInRange(
        { from: w.startISO, to: w.endISO, patient_id: query.patient_id },
        access
      ),
      reportRepository.listServicesInRange(
        w.startYMD,
        w.endYMD,
        { patient_id: query.patient_id },
        access
      ),
      reportRepository.listReceiptsInRange(
        w.startISO,
        w.endISO,
        { patient_id: query.patient_id },
        access
      )
    ]);
    if (!billings.success) return passFailure(billings);
    if (!services.success) return passFailure(services);
    if (!receipts.success) return passFailure(receipts);

    return success(
      buildBillingTotals(
        w.period,
        { from: w.startISO, to: w.endISO },
        {
          billings: (billings.data || []).map((b) => ({
            id: b.id as string | null,
            status: b.status as string | null
          })),
          services: castRows(services),
          receipts: castRows(receipts)
        }
      )
    );
  },

  // ─────────────────────────────────────────────────────────────────────
  // Payout totals (filtered)
  // ─────────────────────────────────────────────────────────────────────

  async payoutTotals(
    rawQuery: unknown,
    ctx: ReportServiceContext
  ): Promise<ApiResult<PayoutTotalsReport>> {
    const parsed = parseInput(payoutTotalsQuerySchema, rawQuery ?? {});
    if (!parsed.success) return passFailure(parsed);
    const query = parsed.data as PayoutTotalsQuery;
    const w = resolveWindow(query);
    const access = dbAccess(ctx);

    const payouts = await reportRepository.listPayoutsForPeriod(
      w.period,
      { employee_id: query.employee_id },
      access
    );
    if (!payouts.success) return passFailure(payouts);

    return success(
      buildPayoutTotals(
        w.period,
        { from: w.startISO, to: w.endISO },
        castRows(payouts)
      )
    );
  },

  // ─────────────────────────────────────────────────────────────────────
  // Profit / Loss
  // ─────────────────────────────────────────────────────────────────────

  async profitLoss(
    rawQuery: unknown,
    ctx: ReportServiceContext
  ): Promise<ApiResult<ProfitLossReport>> {
    const parsed = parseInput(profitLossQuerySchema, rawQuery ?? {});
    if (!parsed.success) return passFailure(parsed);
    const query = parsed.data as ProfitLossQuery;
    const w = resolveWindow(query);
    const access = dbAccess(ctx);

    const [receipts, payouts, payoutCharges] = await Promise.all([
      reportRepository.listReceiptsInRange(w.startISO, w.endISO, {}, access),
      reportRepository.listPayoutsForPeriod(w.period, {}, access),
      reportRepository.listPayoutChargesInRange(w.startYMD, w.endYMD, {}, access)
    ]);
    if (!receipts.success) return passFailure(receipts);
    if (!payouts.success) return passFailure(payouts);
    if (!payoutCharges.success) return passFailure(payoutCharges);

    return success(
      buildProfitLoss(
        w.period,
        { from: w.startISO, to: w.endISO },
        {
          receipts: castRows(receipts),
          payouts: castRows(payouts),
          payout_charges: castRows(payoutCharges)
        }
      )
    );
  },

  // ─────────────────────────────────────────────────────────────────────
  // Payroll (per-employee table)
  // ─────────────────────────────────────────────────────────────────────

  async payroll(
    rawQuery: unknown,
    ctx: ReportServiceContext
  ): Promise<
    ApiResult<{
      period: string;
      range: { from: string; to: string };
      rows: Array<JsonRow & { attendance: { present: number; absent: number; late: number; hours: number } }>;
      totals: PayrollTotals;
    }>
  > {
    const parsed = parseInput(payrollQuerySchema, rawQuery ?? {});
    if (!parsed.success) return passFailure(parsed);
    const query = parsed.data as PayrollQuery;
    const w = resolveWindow(query);
    const access = dbAccess(ctx);

    const [payouts, attendance] = await Promise.all([
      reportRepository.listPayrollRows(
        w.period,
        { employee_id: query.employee_id, status: query.status },
        access
      ),
      reportRepository.listAttendanceInRange(
        w.startISO,
        w.endISO,
        { employee_id: query.employee_id },
        access
      )
    ]);
    if (!payouts.success) return passFailure(payouts);
    if (!attendance.success) return passFailure(attendance);

    const payoutRows = (payouts.data || []) as JsonRow[];
    const rows = attachAttendanceToPayrollRows(
      payoutRows.map((r) => ({
        employee_id: String(r.employee_id || ""),
        gross_amount: r.gross_amount as number | string | null | undefined,
        advance: r.advance as number | string | null | undefined,
        deduction: r.deduction as number | string | null | undefined,
        bonus: r.bonus as number | string | null | undefined,
        net_amount: r.net_amount as number | string | null | undefined,
        ...r
      })),
      (attendance.data || []).map((a) => ({
        employee_id: String(a.employee_id || ""),
        status: (a.status as string | null) ?? undefined,
        hours: (a.hours as number | string | null) ?? undefined
      }))
    );

    return success({
      period: w.period,
      range: { from: w.startISO, to: w.endISO },
      rows,
      totals: aggregatePayrollTotals(rows)
    });
  }
};

/**
 * Repository helpers may return ApiResult<T> with .data possibly undefined.
 * Centralised cast so the business layer only sees plain arrays.
 */
function castRows<T = JsonRow>(result: ApiResult<JsonRow[]>): T[] {
  if (!result.success) return [];
  return ((result.data as JsonRow[]) || []) as T[];
}

export type { DashboardKpis, BillingTotalsReport, PayoutTotalsReport, ProfitLossReport };
