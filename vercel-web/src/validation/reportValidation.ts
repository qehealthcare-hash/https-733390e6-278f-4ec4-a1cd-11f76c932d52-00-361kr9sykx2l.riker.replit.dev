import { z } from "zod";
import {
  idSchema,
  isoDate,
  monthPeriodSchema,
  positiveInt
} from "@/validation/commonValidation";

/**
 * Dashboard query.
 *
 * - `period` (YYYY-MM) — when omitted, the service uses the current UTC month.
 *   Used to scope monthly counts (inquiries / collections / payouts).
 * - `from` / `to` — explicit ISO range overrides for filters that want a
 *   non-calendar-month window (e.g. last 30 days).
 * - Filters tighten the count denominators: only counts that touch the
 *   filtered entity respect them.
 */
export const dashboardQuerySchema = z
  .object({
    period: monthPeriodSchema.optional(),
    month: monthPeriodSchema.optional(), // legacy alias
    from: isoDate.optional(),
    to: isoDate.optional(),
    patient_id: idSchema.optional(),
    employee_id: idSchema.optional(),
    status: z.string().optional()
  })
  .refine(
    (v) => !v.from || !v.to || new Date(v.from).getTime() <= new Date(v.to).getTime(),
    { message: "from must be ≤ to", path: ["from"] }
  );

export const payrollQuerySchema = z
  .object({
    period: monthPeriodSchema.optional(),
    month: monthPeriodSchema.optional(),
    employee_id: idSchema.optional(),
    status: z.string().optional()
  });

export const billingTotalsQuerySchema = z.object({
  period: monthPeriodSchema.optional(),
  month: monthPeriodSchema.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  patient_id: idSchema.optional()
});

export const payoutTotalsQuerySchema = z.object({
  period: monthPeriodSchema.optional(),
  month: monthPeriodSchema.optional(),
  employee_id: idSchema.optional()
});

export const profitLossQuerySchema = z.object({
  period: monthPeriodSchema.optional(),
  month: monthPeriodSchema.optional(),
  from: isoDate.optional(),
  to: isoDate.optional()
});

export const reportListQuerySchema = z.object({
  limit: positiveInt.optional().default(50),
  offset: positiveInt.optional().default(0)
});

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
export type PayrollQuery = z.infer<typeof payrollQuerySchema>;
export type BillingTotalsQuery = z.infer<typeof billingTotalsQuerySchema>;
export type PayoutTotalsQuery = z.infer<typeof payoutTotalsQuerySchema>;
export type ProfitLossQuery = z.infer<typeof profitLossQuerySchema>;
