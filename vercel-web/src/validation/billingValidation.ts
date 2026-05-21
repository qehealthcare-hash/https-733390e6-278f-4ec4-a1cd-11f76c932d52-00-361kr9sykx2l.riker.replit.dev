import { z } from "zod";
import { idSchema, moneySchema } from "@/validation/commonValidation";

export const billingSchema = z.object({
  id: idSchema.optional(),
  patient_id: idSchema,
  status: z.enum(["Active", "Closed", "Cancelled"]).default("Active"),
  sec_dep: moneySchema.optional().default(0)
});

export const billingStatusSchema = z.object({
  status: z.enum(["Active", "Closed", "Cancelled"])
});

export const receiptSchema = z.object({
  id: idSchema.optional(),
  billing_id: idSchema,
  date: z.string().optional().default(""),
  type: z.string().optional().default(""),
  amount: moneySchema,
  method: z.string().optional().default(""),
  ref: z.string().optional().default(""),
  remarks: z.string().optional().default("")
});

export const generateFromDutySchema = z.object({
  duty_id: idSchema,
  service_name: z.string().default("Caretaker"),
  rate_overrides: z
    .object({
      DAY: moneySchema.optional(),
      NIGHT: moneySchema.optional(),
      "24H": moneySchema.optional(),
      FULL: moneySchema.optional()
    })
    .optional()
});

export const shiftRatesSchema = z.object({
  DAY: moneySchema,
  NIGHT: moneySchema,
  "24H": moneySchema,
  FULL: moneySchema
});

export type BillingInput = z.infer<typeof billingSchema>;
export type BillingStatusInput = z.infer<typeof billingStatusSchema>;
export type ReceiptInput = z.infer<typeof receiptSchema>;
export type GenerateFromDutyInput = z.infer<typeof generateFromDutySchema>;
export type ShiftRatesInput = z.infer<typeof shiftRatesSchema>;

/** Default shift rate hints (business layer may override from DB). */
export type ShiftRates = { DAY: number; NIGHT: number; "24H": number; FULL: number };
export const DEFAULT_SHIFT_RATES: ShiftRates = { DAY: 700, NIGHT: 900, "24H": 1500, FULL: 1500 };
