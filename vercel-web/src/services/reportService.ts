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
  inquiriesSummaryQuerySchema,
  patientsSummaryQuerySchema,
  attendanceSummaryQuerySchema,
  billingsSummaryQuerySchema,
  type DashboardQuery,
  type PayrollQuery,
  type BillingTotalsQuery,
  type PayoutTotalsQuery,
  type ProfitLossQuery,
  type InquiriesSummaryQuery,
  type PatientsSummaryQuery,
  type AttendanceSummaryQuery,
  type BillingsSummaryQuery
} from "@/validation/reportValidation";
import { parseInput } from "@/validation/parseValidation";
import {
  aggregatePayrollTotals,
  buildBillingTotals,
  buildDashboardKpis,
  buildPayoutTotals,
  buildProfitLoss,
  buildInquirySummary,
  buildPatientSummary,
  buildAttendanceSummaryFromLedger,
  attachLedgerAttendanceToPayrollRows,
  buildBillingSummary,
  INQUIRY_STATUS_BUCKETS,
  monthRangeUTC,
  type BillingTotalsReport,
  type DashboardKpis,
  type DashboardRawCounts,
  type PayoutTotalsReport,
  type ProfitLossReport,
  type PayrollTotals,
  type InquirySummary,
  type PatientSummary,
  type AttendanceSummary,
  type BillingSummary
} from "@/business/reportRules";
import {
  reportRepository,
  REPORT_ROW_CEILING
} from "@/database/reportRepository";
import { dutyRepository, type DutyMasterReconciliationReport } from "@/database/dutyRepository";
import { billingRepository } from "@/database/billingRepository";
import { patientRepository } from "@/database/patientRepository";
import { computeBillingTotals, derivePaidStatus } from "@/business/billingRules";
import { passFailure, success } from "@/utils/apiResponse";
import {
  computeDashboardDutyKpisFromLedger,
  getDutyRowsByPeriod,
  listAttendanceLedgersForPeriod
} from "@/src/lib/duty-ledger";

import type { JsonRow } from "@/database/types";
import type { ServiceActor } from "@/types/serviceActor";

/** @deprecated Import `ServiceActor` from `@/types/serviceActor`. */
export type ActorLike = ServiceActor;

export interface ReportServiceContext {
  actor: ServiceActor;
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

function previousCalendarDay(ymd: string): string {
  const date = new Date(`${ymd}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
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
      billingsTotal,
      billingsOpen,
      billingsClosed,
      services,
      receipts,
      payouts,
      payoutCharges,
      dutyRowsForPeriod
    ] = await Promise.all([
      reportRepository.countAllPatients(access),
      reportRepository.countActivePatients(access),
      reportRepository.countAllEmployees(access),
      reportRepository.countActiveEmployees(access),
      reportRepository.countInquiriesInRange(w.startISO, w.endISO, access),
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
      ),
      getDutyRowsByPeriod(w.period, access)
    ]);

    const serviceRows = castRows(services);
    const dutiesById = new Map<string, JsonRow>();
    if (dutyRowsForPeriod.success) {
      for (const d of dutyRowsForPeriod.data || []) {
        dutiesById.set(String(d.id), d);
      }
    }
    const dutyKpis = computeDashboardDutyKpisFromLedger(serviceRows, dutiesById);

    const raw: DashboardRawCounts = {
      patients_total: expect(patientsTotal, 0),
      patients_active: expect(patientsActive, 0),
      employees_total: expect(employeesTotal, 0),
      employees_active: expect(employeesActive, 0),
      inquiries_this_month: expect(inquiries, 0),
      duties_active: dutyKpis.duties_active,
      duties_scheduled: dutyKpis.duties_scheduled,
      duties_completed: dutyKpis.duties_completed,
      duties_cancelled: dutyKpis.duties_cancelled,
      billings_total: expect(billingsTotal, 0),
      billings_open: expect(billingsOpen, 0),
      billings_closed: expect(billingsClosed, 0),
      service_rows: serviceRows,
      receipt_rows: castRows(receipts),
      payout_rows: castRows(payouts),
      payout_charge_rows: castRows(payoutCharges)
    };

    return success(
      buildDashboardKpis(w.period, { from: w.startISO, to: w.endISO }, raw)
    );
  },

  async reconciliation(
    rawQuery: unknown,
    ctx: ReportServiceContext
  ): Promise<ApiResult<DutyMasterReconciliationReport | null>> {
    const query = (rawQuery || {}) as {
      period?: string;
      from?: string;
      to?: string;
    };
    const w = resolveWindow(query);
    return dutyRepository.dutyMasterReconciliationReport(
      w.startYMD,
      w.customRange ? w.endYMD : previousCalendarDay(w.endYMD),
      ctx.actor.email || "reconciliation@hominal.system",
      dbAccess(ctx)
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

    const [services, receipts] = await Promise.all([
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
    if (!services.success) return passFailure(services);
    if (!receipts.success) return passFailure(receipts);

    const serviceRows = castRows(services);
    const receiptRows = castRows(receipts);
    const billingIds = new Set<string>();
    for (const s of serviceRows) {
      const id = String(s.billing_id || "");
      if (id) billingIds.add(id);
    }
    for (const r of receiptRows) {
      const id = String(r.billing_id || "");
      if (id) billingIds.add(id);
    }
    const billings = await reportRepository.listBillingsByIds([...billingIds], access);
    if (!billings.success) return passFailure(billings);

    return success(
      buildBillingTotals(
        w.period,
        { from: w.startISO, to: w.endISO },
        {
          billings: (billings.data || []).map((b) => ({
            id: b.id as string | null,
            status: b.status as string | null
          })),
          services: serviceRows,
          receipts: receiptRows
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

    const [payouts, payoutCharges] = await Promise.all([
      reportRepository.listPayoutsForPeriod(
        w.period,
        { employee_id: query.employee_id },
        access
      ),
      reportRepository.listPayoutChargesInRange(
        w.startYMD,
        w.endYMD,
        { partner_id: query.employee_id },
        access
      )
    ]);
    if (!payouts.success) return passFailure(payouts);
    if (!payoutCharges.success) return passFailure(payoutCharges);

    return success(
      buildPayoutTotals(
        w.period,
        { from: w.startISO, to: w.endISO },
        castRows(payouts),
        castRows(payoutCharges)
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

    const [payouts, attendanceLedgers] = await Promise.all([
      reportRepository.listPayrollRows(
        w.period,
        { employee_id: query.employee_id, status: query.status },
        access
      ),
      listAttendanceLedgersForPeriod(w.period, access, {
        employee_id: query.employee_id
      })
    ]);
    if (!payouts.success) return passFailure(payouts);
    if (!attendanceLedgers.success) return passFailure(attendanceLedgers);

    const payoutRows = (payouts.data || []) as JsonRow[];
    const rows = attachLedgerAttendanceToPayrollRows(
      payoutRows.map((r) => ({
        employee_id: String(r.employee_id || ""),
        gross_amount: r.gross_amount as number | string | null | undefined,
        advance: r.advance as number | string | null | undefined,
        deduction: r.deduction as number | string | null | undefined,
        bonus: r.bonus as number | string | null | undefined,
        net_amount: r.net_amount as number | string | null | undefined,
        ...r
      })),
      attendanceLedgers.data || new Map()
    );

    return success({
      period: w.period,
      range: { from: w.startISO, to: w.endISO },
      rows,
      totals: aggregatePayrollTotals(rows)
    });
  },

  // ─────────────────────────────────────────────────────────────────────
  // Per-tab summaries (Phase 12 — server-side aggregation)
  // ─────────────────────────────────────────────────────────────────────
  //
  // Each summary method returns a `{ summary, rows, rows_total, limit, offset }`
  // envelope. The headline `summary.total` and `rows_total` always come from
  // Supabase `count='exact'` so they are accurate for the entire window,
  // independent of the paginated `rows` slice.

  async inquiriesSummary(
    rawQuery: unknown,
    ctx: ReportServiceContext
  ): Promise<ApiResult<SummaryEnvelope<InquirySummary, JsonRow>>> {
    const parsed = parseInput(inquiriesSummaryQuerySchema, rawQuery ?? {});
    if (!parsed.success) return passFailure(parsed);
    const query = parsed.data as InquiriesSummaryQuery;
    const w = resolveWindow(query);
    const access = dbAccess(ctx);

    const statusCountTasks = INQUIRY_STATUS_BUCKETS.map((s) =>
      reportRepository.countInquiriesScoped(
        w.startISO,
        w.endISO,
        {
          status: query.status || s,
          source: query.source,
          assigned_to: query.assigned_to
        },
        access
      )
    );

    const [total, followupDue, groupRows, rows, ...statusCounts] = await Promise.all([
      reportRepository.countInquiriesScoped(
        w.startISO,
        w.endISO,
        {
          status: query.status,
          source: query.source,
          assigned_to: query.assigned_to
        },
        access
      ),
      reportRepository.countInquiriesFollowupDue(w.startYMD, w.endYMD, access),
      reportRepository.listInquiriesForGroupBy(w.startISO, w.endISO, access),
      reportRepository.listInquiriesScoped(
        w.startISO,
        w.endISO,
        {
          status: query.status,
          source: query.source,
          assigned_to: query.assigned_to
        },
        { limit: query.limit, offset: query.offset },
        access
      ),
      ...statusCountTasks
    ]);
    if (!total.success) return passFailure(total);
    if (!followupDue.success) return passFailure(followupDue);
    if (!groupRows.success) return passFailure(groupRows);
    if (!rows.success) return passFailure(rows);

    const byStatusOverrides: Record<string, number> = {};
    INQUIRY_STATUS_BUCKETS.forEach((s, i) => {
      const r = statusCounts[i] as ApiResult<number> | undefined;
      if (!r || !r.success) return;
      if (query.status) {
        byStatusOverrides[s] = s === query.status ? r.data || 0 : 0;
      } else {
        byStatusOverrides[s] = r.data || 0;
      }
    });

    const summary = buildInquirySummary(
      w.period,
      { from: w.startISO, to: w.endISO },
      {
        total: total.data || 0,
        followup_due: followupDue.data || 0,
        groupRows: (groupRows.data || []) as Parameters<typeof buildInquirySummary>[2]["groupRows"],
        byStatusOverrides,
        groupingTruncated: (groupRows.data || []).length >= REPORT_ROW_CEILING
      }
    );

    return success({
      summary,
      rows: rows.data || [],
      rows_total: total.data || 0,
      limit: query.limit,
      offset: query.offset
    });
  },

  async patientsSummary(
    rawQuery: unknown,
    ctx: ReportServiceContext
  ): Promise<ApiResult<SummaryEnvelope<PatientSummary, JsonRow>>> {
    const parsed = parseInput(patientsSummaryQuerySchema, rawQuery ?? {});
    if (!parsed.success) return passFailure(parsed);
    const query = parsed.data as PatientsSummaryQuery;
    const w = resolveWindow(query);
    const access = dbAccess(ctx);

    const [total, activeCount, inactiveCount, groupRows, rows] = await Promise.all([
      reportRepository.countPatientsScoped(
        w.startISO,
        w.endISO,
        { status: query.status, area: query.area },
        access
      ),
      reportRepository.countPatientsScoped(
        w.startISO,
        w.endISO,
        { status: "Active", area: query.area },
        access
      ),
      reportRepository.countPatientsScoped(
        w.startISO,
        w.endISO,
        { status: "Inactive", area: query.area },
        access
      ),
      reportRepository.listPatientsForGroupBy(w.startISO, w.endISO, access),
      reportRepository.listPatientsScoped(
        w.startISO,
        w.endISO,
        { status: query.status, area: query.area },
        { limit: query.limit, offset: query.offset },
        access
      )
    ]);
    if (!total.success) return passFailure(total);
    if (!activeCount.success) return passFailure(activeCount);
    if (!inactiveCount.success) return passFailure(inactiveCount);
    if (!groupRows.success) return passFailure(groupRows);
    if (!rows.success) return passFailure(rows);

    const byStatusOverrides: Record<string, number> = query.status
      ? { [query.status]: total.data || 0 }
      : { Active: activeCount.data || 0, Inactive: inactiveCount.data || 0 };

    const summary = buildPatientSummary(
      w.period,
      { from: w.startISO, to: w.endISO },
      {
        total: total.data || 0,
        groupRows: (groupRows.data || []) as Parameters<typeof buildPatientSummary>[2]["groupRows"],
        byStatusOverrides,
        groupingTruncated: (groupRows.data || []).length >= REPORT_ROW_CEILING
      }
    );

    return success({
      summary,
      rows: rows.data || [],
      rows_total: total.data || 0,
      limit: query.limit,
      offset: query.offset
    });
  },

  async attendanceSummary(
    rawQuery: unknown,
    ctx: ReportServiceContext
  ): Promise<ApiResult<SummaryEnvelope<AttendanceSummary, JsonRow>>> {
    const parsed = parseInput(attendanceSummaryQuerySchema, rawQuery ?? {});
    if (!parsed.success) return passFailure(parsed);
    const query = parsed.data as AttendanceSummaryQuery;
    const w = resolveWindow(query);
    const access = dbAccess(ctx);

    const [ledgers, sliceRows] = await Promise.all([
      listAttendanceLedgersForPeriod(w.period, access, {
        employee_id: query.employee_id
      }),
      reportRepository.listAttendanceScoped(
        w.startISO,
        w.endISO,
        { employee_id: query.employee_id, status: query.status },
        { limit: query.limit, offset: query.offset },
        access
      )
    ]);
    if (!ledgers.success) return passFailure(ledgers);
    if (!sliceRows.success) return passFailure(sliceRows);

    const summary = buildAttendanceSummaryFromLedger(
      w.period,
      { from: w.startISO, to: w.endISO },
      ledgers.data || new Map()
    );
    if (query.employee_id) {
      const filtered = (summary.by_employee || []).filter(
        (e) => e.employee_id === query.employee_id
      );
      summary.by_employee = filtered;
      summary.total = filtered.reduce((s, e) => s + e.present, 0);
      summary.by_status.PRESENT = summary.total;
    }

    return success({
      summary,
      rows: sliceRows.data || [],
      rows_total: summary.total,
      limit: query.limit,
      offset: query.offset
    });
  },

  async billingsSummary(
    rawQuery: unknown,
    ctx: ReportServiceContext
  ): Promise<ApiResult<SummaryEnvelope<BillingSummary, JsonRow>>> {
    const parsed = parseInput(billingsSummaryQuerySchema, rawQuery ?? {});
    if (!parsed.success) return passFailure(parsed);
    const query = parsed.data as BillingsSummaryQuery;
    const w = resolveWindow(query);
    const access = dbAccess(ctx);

    const [svcRes, rcptRes] = await Promise.all([
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
    if (!svcRes.success) return passFailure(svcRes);
    if (!rcptRes.success) return passFailure(rcptRes);

    const serviceRows = svcRes.data || [];
    const receiptRows = rcptRes.data || [];
    const activeIds = new Set<string>();
    for (const s of serviceRows) {
      const id = String(s.billing_id || "");
      if (id) activeIds.add(id);
    }
    for (const r of receiptRows) {
      const id = String(r.billing_id || "");
      if (id) activeIds.add(id);
    }

    const billings = activeIds.size
      ? await billingRepository.listBillingsByIds([...activeIds], access)
      : ({ success: true, data: [] as JsonRow[] } as ApiResult<JsonRow[]>);
    if (!billings.success) return passFailure(billings);

    const summary = buildBillingSummary(
      w.period,
      { from: w.startISO, to: w.endISO },
      {
        billings: (billings.data || []).map((b) => ({
          id: b.id as string | null,
          status: b.status as string | null
        })),
        services: serviceRows,
        receipts: receiptRows
      }
    );

    // Build per-billing rows for the paginated slice.
    //
    // Per-bill paid_status / outstanding MUST reflect the bill's full lifetime
    // ledger, not just the rows inside the report window. Otherwise a fully
    // paid bill whose receipt was recorded in a different month than its
    // services shows a phantom outstanding balance (window has the services
    // but not the matching receipt). The windowed serviceRows/receiptRows are
    // still used above for the period revenue aggregate (buildBillingSummary).
    const billingIdsForRows = [...activeIds];
    const [fullSvcRes, fullRcptRes] = await Promise.all([
      billingRepository.listSvcByBillingIds(billingIdsForRows, access),
      billingRepository.listActiveReceiptsByBillingIds(billingIdsForRows, access)
    ]);
    if (!fullSvcRes.success) return passFailure(fullSvcRes);
    if (!fullRcptRes.success) return passFailure(fullRcptRes);

    const billingMap = new Map<string, JsonRow>();
    for (const b of billings.data || []) billingMap.set(String(b.id || ""), b);
    const svcByBilling = new Map<string, JsonRow[]>();
    for (const s of fullSvcRes.data || []) {
      const bid = String(s.billing_id || "");
      if (!bid) continue;
      if (!svcByBilling.has(bid)) svcByBilling.set(bid, []);
      svcByBilling.get(bid)!.push(s);
    }
    const rcptByBilling = new Map<string, JsonRow[]>();
    for (const r of fullRcptRes.data || []) {
      const bid = String(r.billing_id || "");
      if (!bid) continue;
      if (!rcptByBilling.has(bid)) rcptByBilling.set(bid, []);
      rcptByBilling.get(bid)!.push(r);
    }

    const patientIds = Array.from(
      new Set(
        (billings.data || [])
          .map((b) => String(b.patient_id || ""))
          .filter(Boolean)
      )
    );
    const patientsRes = await patientRepository.findByIds(patientIds, access);
    if (!patientsRes.success) return passFailure(patientsRes);
    const patientMap = new Map<string, { name: string; phone: string }>();
    for (const p of patientsRes.data || []) {
      patientMap.set(String(p.id || ""), {
        name: String(p.name || "").trim(),
        phone: String(p.phone || "").trim()
      });
    }

    const enrichedAll: JsonRow[] = [];
    for (const id of activeIds) {
      const b =
        billingMap.get(id) ||
        ({ id, status: "Unknown", patient_id: "", sec_dep: 0 } as JsonRow);
      const totals = computeBillingTotals({
        services: (svcByBilling.get(id) || []) as { total?: number | string | null }[],
        receipts: (rcptByBilling.get(id) || []) as { amount?: number | string | null }[],
        secDep: Number(b.sec_dep || 0)
      });
      const patient = patientMap.get(String(b.patient_id || "")) || null;
      enrichedAll.push({
        ...b,
        patient_name: patient?.name || "",
        patient_phone: patient?.phone || "",
        totals,
        // Derive from the full-lifetime totals so the badge and the outstanding
        // figure can never disagree (a stored paid_status can go stale).
        paid_status: derivePaidStatus(totals)
      });
    }

    const filtered = enrichedAll.filter((b) => {
      if (query.status && String(b.status || "") !== query.status) return false;
      if (query.patient_id && String(b.patient_id || "") !== query.patient_id) return false;
      return true;
    });
    filtered.sort((a, b) =>
      String(b.created_at || "").localeCompare(String(a.created_at || ""))
    );
    const offset = query.offset;
    const limit = Math.min(query.limit, REPORT_ROW_CEILING);
    const sliceRows = filtered.slice(offset, offset + limit);

    return success({
      summary,
      rows: sliceRows,
      rows_total: filtered.length,
      limit,
      offset
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

export interface SummaryEnvelope<TSummary, TRow> {
  summary: TSummary;
  rows: TRow[];
  rows_total: number;
  limit: number;
  offset: number;
}

export type {
  DashboardKpis,
  BillingTotalsReport,
  PayoutTotalsReport,
  ProfitLossReport,
  InquirySummary,
  PatientSummary,
  AttendanceSummary,
  BillingSummary
};
