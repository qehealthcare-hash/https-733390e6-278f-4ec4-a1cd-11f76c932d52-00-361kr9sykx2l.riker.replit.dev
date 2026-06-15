import { z } from "zod";
import { monthPeriodSchema } from "@/validation/commonValidation";

const reportRangeDtoSchema = z.object({
  from: z.string(),
  to: z.string()
});

/** GET /reports/billing-totals and /billings/totals response body. */
export const billingTotalsReportDtoSchema = z.object({
  period: monthPeriodSchema.or(z.string()),
  range: reportRangeDtoSchema,
  billings_count: z.number(),
  service_total: z.number(),
  collected: z.number(),
  pending: z.number(),
  byStatus: z.record(z.string(), z.object({ count: z.number() }))
});
export type BillingTotalsReportDto = z.infer<typeof billingTotalsReportDtoSchema>;

/** GET /reports/payout-totals and /payouts/totals response body. */
export const payoutTotalsReportDtoSchema = z.object({
  period: monthPeriodSchema.or(z.string()),
  range: reportRangeDtoSchema,
  rows_count: z.number(),
  gross: z.number(),
  net: z.number(),
  paid: z.number(),
  pending: z.number(),
  partner_charge_ledger: z.number(),
  advance: z.number(),
  deduction: z.number(),
  bonus: z.number()
});
export type PayoutTotalsReportDto = z.infer<typeof payoutTotalsReportDtoSchema>;

/** GET /reports/dashboard response body (duty-ledger-backed KPIs). */
export const dashboardReportDtoSchema = z.object({
  period: z.string(),
  range: reportRangeDtoSchema,
  patients_total: z.number().int().nonnegative(),
  patients_active: z.number().int().nonnegative(),
  employees_total: z.number().int().nonnegative(),
  employees_active: z.number().int().nonnegative(),
  inquiries_this_month: z.number().int().nonnegative(),
  duties_active: z.number().int().nonnegative(),
  duties_scheduled: z.number().int().nonnegative(),
  duties_completed: z.number().int().nonnegative(),
  duties_cancelled: z.number().int().nonnegative(),
  billings_total: z.number().int().nonnegative(),
  billings_open: z.number().int().nonnegative(),
  billings_closed: z.number().int().nonnegative(),
  billing_total_amount: z.number(),
  billing_collected_amount: z.number(),
  billing_pending_amount: z.number(),
  payout_total_amount: z.number(),
  payout_gross_amount: z.number(),
  payout_paid_amount: z.number(),
  payout_pending_amount: z.number(),
  partner_charge_ledger: z.number(),
  profit_loss: z.number(),
  profit_loss_after_pending: z.number()
});
export type DashboardReportDto = z.infer<typeof dashboardReportDtoSchema>;

/** GET /reports/profit-loss response body. */
export const profitLossReportDtoSchema = z.object({
  period: z.string(),
  range: reportRangeDtoSchema,
  revenue: z.number(),
  payouts_paid: z.number(),
  payouts_pending: z.number(),
  partner_charge_ledger: z.number(),
  net_profit: z.number(),
  net_profit_after_pending_payouts: z.number()
});
export type ProfitLossReportDto = z.infer<typeof profitLossReportDtoSchema>;

const payrollAttendanceDtoSchema = z.object({
  present: z.number(),
  absent: z.number(),
  late: z.number(),
  hours: z.number()
});

const payrollTotalsDtoSchema = z.object({
  gross: z.number(),
  net: z.number(),
  advance: z.number(),
  deduction: z.number(),
  bonus: z.number()
});

/** GET /reports/payroll response body. */
export const payrollReportDtoSchema = z.object({
  period: z.string(),
  range: reportRangeDtoSchema,
  rows: z.array(
    z
      .object({
        attendance: payrollAttendanceDtoSchema
      })
      .passthrough()
  ),
  totals: payrollTotalsDtoSchema
});
export type PayrollReportDto = z.infer<typeof payrollReportDtoSchema>;

const attendanceByEmployeeDtoSchema = z.object({
  employee_id: z.string(),
  present: z.number(),
  absent: z.number(),
  late: z.number(),
  half_day: z.number(),
  leave: z.number(),
  holiday: z.number(),
  hours: z.number()
});

/** GET /reports/attendance response body. */
export const attendanceSummaryReportDtoSchema = z.object({
  period: z.string(),
  range: reportRangeDtoSchema,
  total: z.number().int().nonnegative(),
  by_status: z.record(z.string(), z.number()),
  by_shift: z.record(z.string(), z.number()),
  by_employee: z.array(attendanceByEmployeeDtoSchema)
});
export type AttendanceSummaryReportDto = z.infer<typeof attendanceSummaryReportDtoSchema>;

const reportRowDtoSchema = z.record(z.string(), z.unknown());

function reportSummaryEnvelopeSchema<T extends z.ZodTypeAny>(summarySchema: T) {
  return z.object({
    summary: summarySchema,
    rows: z.array(reportRowDtoSchema),
    rows_total: z.number().int().nonnegative(),
    limit: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative()
  });
}

export const inquirySummaryReportDtoSchema = z.object({
  period: z.string(),
  range: reportRangeDtoSchema,
  total: z.number().int().nonnegative(),
  followup_due: z.number().int().nonnegative(),
  by_status: z.record(z.string(), z.number()),
  by_potential: z.record(z.string(), z.number()),
  by_source: z.record(z.string(), z.number()),
  grouping_truncated: z.boolean()
});

/** GET /reports/inquiries response body. */
export const reportInquiriesSummaryResponseDtoSchema = reportSummaryEnvelopeSchema(
  inquirySummaryReportDtoSchema
);

export const patientSummaryReportDtoSchema = z.object({
  period: z.string(),
  range: reportRangeDtoSchema,
  total: z.number().int().nonnegative(),
  by_status: z.record(z.string(), z.number()),
  by_area: z.record(z.string(), z.number()),
  grouping_truncated: z.boolean()
});

/** GET /reports/patients response body. */
export const reportPatientsSummaryResponseDtoSchema = reportSummaryEnvelopeSchema(
  patientSummaryReportDtoSchema
);

export const billingPeriodSummaryReportDtoSchema = billingTotalsReportDtoSchema.extend({
  total_received: z.number(),
  outstanding: z.number()
});

/** GET /reports/billings response body. */
export const reportBillingsSummaryResponseDtoSchema = reportSummaryEnvelopeSchema(
  billingPeriodSummaryReportDtoSchema
);

const dutyReconciliationMismatchDtoSchema = z.object({
  patient_id: z.string().optional(),
  employee_id: z.string().optional(),
  expected_amount: z.number(),
  actual_amount: z.number(),
  difference: z.number()
});

/** GET /reports/reconciliation response body. */
export const dutyReconciliationReportDtoSchema = z
  .object({
    ok: z.boolean(),
    from: z.string(),
    to: z.string(),
    rules: z.array(z.string()).optional(),
    summary: z.record(z.string(), z.unknown()),
    patient_billing_mismatches: z.array(dutyReconciliationMismatchDtoSchema).optional(),
    employee_payout_mismatches: z.array(dutyReconciliationMismatchDtoSchema).optional()
  })
  .passthrough();

export const dutyReconciliationResponseDtoSchema = dutyReconciliationReportDtoSchema.nullable();
