import { z } from "zod";
import { idSchema, isoDate, moneySchema, monthPeriodSchema } from "@/validation/commonValidation";

/** Lifecycle states recognised for a billing record. */
export const BILLING_STATUSES = ["Active", "Closed", "Cancelled"] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];

/**
 * Statuses where the bill is treated as a *closed ledger* — no new service
 * entries, no new receipts, no edits, no duty-billing sync.
 *
 * `Cancelled` is closed for editing too (cancelled bills are not reopened —
 * the caller has to issue a new bill).
 */
export const BILLING_CLOSED_STATUSES = new Set<BillingStatus>(["Closed", "Cancelled"]);

/** Statuses considered "open" — editable + accept new service / receipt rows. */
export const BILLING_OPEN_STATUSES = new Set<BillingStatus>(["Active"]);

/** Default shift→rate table used when an admin override is not provided. */
export type ShiftRates = { DAY: number; NIGHT: number; "24H": number; FULL: number };
export const DEFAULT_SHIFT_RATES: ShiftRates = { DAY: 700, NIGHT: 900, "24H": 1500, FULL: 1500 };

export const shiftRatesSchema = z.object({
  DAY: moneySchema,
  NIGHT: moneySchema,
  "24H": moneySchema,
  FULL: moneySchema
});

/** Canonical Billing input. `sec_dep` is the only structural editable field. */
export const billingSchema = z.object({
  id: idSchema.optional(),
  patient_id: idSchema,
  status: z.enum(BILLING_STATUSES).default("Active"),
  sec_dep: moneySchema.optional().default(0),
  notes: z.string().optional().default("")
});

/** PATCH body for `/billings/[id]/status`. */
export const billingStatusSchema = z.object({
  status: z.enum(BILLING_STATUSES)
});

/** Closing a bill requires acknowledging the closing actor. */
export const billingCloseSchema = z.object({
  reason: z.string().trim().max(500).optional().default(""),
  /** If true, allow closing even with outstanding > 0 (Admin override). */
  force: z.boolean().optional().default(false)
});

/** Reopening a Closed bill always requires an explicit reason for audit. */
export const billingReopenSchema = z.object({
  reason: z.string().trim().min(1, "reason is required to reopen a closed bill").max(500)
});

/** Editable bill body — same as billingSchema but every field is optional for PATCH. */
export const billingEditSchema = z
  .object({
    sec_dep: moneySchema.optional(),
    notes: z.string().optional()
  })
  .refine((v) => v.sec_dep !== undefined || v.notes !== undefined, {
    message: "At least one field must be provided"
  });

/** Receipt payload — server is the source of truth for billing_id. */
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

/**
 * Generate-from-duty payload.
 *
 * `period` (optional YYYY-MM) constrains the duty's start_at month and prevents
 * a UI from accidentally billing a duty in the wrong cycle.
 */
export const generateFromDutySchema = z.object({
  duty_id: idSchema,
  service_name: z.string().default("Caretaker"),
  period: monthPeriodSchema.optional(),
  rate_overrides: shiftRatesSchema.partial().optional(),
  discount: moneySchema.optional().default(0),
  advance: moneySchema.optional().default(0)
});

/**
 * Bulk-generate-from-duties: take all duties in a YYYY-MM for a patient and
 * append service entries for any that haven't been billed yet. Idempotent.
 */
export const generateFromDutyRangeSchema = z.object({
  patient_id: idSchema,
  period: monthPeriodSchema,
  service_name: z.string().default("Caretaker"),
  rate_overrides: shiftRatesSchema.partial().optional()
});

/** GET /billings query string. */
export const billingListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  q: z.string().optional().default(""),
  patient_id: z.string().optional(),
  status: z.enum(BILLING_STATUSES).optional(),
  period: monthPeriodSchema.optional()
});

export type BillingInput = z.infer<typeof billingSchema>;
export type BillingStatusInput = z.infer<typeof billingStatusSchema>;
export type BillingCloseInput = z.infer<typeof billingCloseSchema>;
export type BillingReopenInput = z.infer<typeof billingReopenSchema>;
export type BillingEditInput = z.infer<typeof billingEditSchema>;
export type ReceiptInput = z.infer<typeof receiptSchema>;
export type GenerateFromDutyInput = z.infer<typeof generateFromDutySchema>;
export type GenerateFromDutyRangeInput = z.infer<typeof generateFromDutyRangeSchema>;
export type BillingListQuery = z.infer<typeof billingListQuerySchema>;
export type ShiftRatesInput = z.infer<typeof shiftRatesSchema>;
