import { z } from "zod";
import { idSchema, moneySchema, monthPeriodSchema } from "@/validation/commonValidation";

export const payoutSchema = z.object({
  employee_id: idSchema,
  period_month: monthPeriodSchema,
  advance: moneySchema.optional().default(0),
  deduction: moneySchema.optional().default(0),
  bonus: moneySchema.optional().default(0),
  remarks: z.string().optional().default("")
});

export const payoutAdjustmentSchema = z.object({
  payout_id: idSchema,
  advance: moneySchema.optional(),
  deduction: moneySchema.optional(),
  bonus: moneySchema.optional(),
  remarks: z.string().optional()
});

export const payoutPaySchema = z.object({
  payout_id: idSchema,
  paid_on: z.string().optional(),
  method: z.string().optional().default(""),
  photo: z.string().optional().default("")
});

export type PayoutInput = z.infer<typeof payoutSchema>;
export type PayoutAdjustmentInput = z.infer<typeof payoutAdjustmentSchema>;
export type PayoutPayInput = z.infer<typeof payoutPaySchema>;
