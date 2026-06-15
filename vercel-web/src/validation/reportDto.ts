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
