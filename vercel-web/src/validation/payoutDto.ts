import { z } from "zod";
import { idSchema, moneySchema, monthPeriodSchema } from "@/validation/commonValidation";
import { PAYOUT_STATUSES } from "@/validation/payoutValidation";

/**
 * Read-model contract for GET /payouts/:id and payout detail refetches.
 * UI must use `permissions` for action gating — not re-derive payout policy.
 */

export const payoutPermissionsDtoSchema = z.object({
  canAdjust: z.boolean(),
  canLock: z.boolean(),
  canReopen: z.boolean(),
  canPayFinal: z.boolean(),
  canPayAdvance: z.boolean(),
  blockReasons: z.record(z.string(), z.string()).optional()
});
export type PayoutPermissionsDto = z.infer<typeof payoutPermissionsDtoSchema>;

export const payoutRowDtoSchema = z.object({
  id: idSchema,
  employee_id: idSchema,
  period_month: monthPeriodSchema,
  status: z.enum(PAYOUT_STATUSES),
  gross_amount: moneySchema.optional(),
  net_amount: moneySchema.optional(),
  advance: moneySchema.optional(),
  deduction: moneySchema.optional(),
  bonus: moneySchema.optional(),
  duty_count: z.number().optional(),
  hours: z.number().optional(),
  remarks: z.string().optional(),
  employee_name: z.string().optional()
});
export type PayoutRowDto = z.infer<typeof payoutRowDtoSchema>;

export const payoutDetailDtoSchema = z.object({
  payout: payoutRowDtoSchema.passthrough(),
  duties: z.array(z.record(z.unknown())),
  attendance: z.array(z.record(z.unknown())),
  breakdown: z.array(z.record(z.unknown())).optional(),
  paid_transactions: z.array(z.record(z.unknown())),
  paid_total: moneySchema,
  outstanding: moneySchema,
  employee_name: z.string(),
  patient_breakdown: z.array(z.record(z.unknown())),
  diagnostics: z.record(z.unknown()),
  permissions: payoutPermissionsDtoSchema
});
export type PayoutDetailDto = z.infer<typeof payoutDetailDtoSchema>;

export function parsePayoutDetailDto(data: unknown) {
  return payoutDetailDtoSchema.safeParse(data);
}
