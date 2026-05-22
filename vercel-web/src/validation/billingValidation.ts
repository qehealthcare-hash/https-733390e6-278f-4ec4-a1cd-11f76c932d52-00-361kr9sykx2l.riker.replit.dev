import { z } from "zod";
import {
  idSchema,
  isoDate,
  moneySchema,
  monthPeriodSchema,
  optionalIsoDate
} from "@/validation/commonValidation";

/** Lifecycle states recognised for a billing record. */
export const BILLING_STATUSES = ["Active", "Closed", "Cancelled", "Paused"] as const;
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
  close_reason_other: z.string().trim().max(500).optional().default(""),
  /** If true, allow closing even with outstanding > 0 (Admin override). */
  force: z.boolean().optional().default(false)
});

/**
 * Legacy SPA upsert payload — mirrors `toSbBilling()` output so Phase 7b can
 * route `sbUpsert('hh_billings')` through the audited service layer.
 */
export const billingLegacySyncSchema = z.object({
  id: idSchema.optional(),
  patient_id: idSchema,
  status: z.enum(BILLING_STATUSES).optional().default("Active"),
  sec_dep: moneySchema.optional().default(0),
  close_reason: z.string().optional().default(""),
  close_reason_other: z.string().optional().default(""),
  pause_reason: z.string().optional().default(""),
  created: z.string().optional().default(""),
  notes: z.string().optional().default("")
});
export type BillingLegacySyncInput = z.infer<typeof billingLegacySyncSchema>;

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
/**
 * Receipt input — accepts the full `hh_receipts` column set the legacy SPA
 * sends. Unknown fields are dropped server-side.
 *
 * The actual write is dispatched to `hominal_save_receipt(p_receipt jsonb)`
 * which atomically updates the receipt + ledger side-effects.
 */
export const receiptSchema = z.object({
  id: idSchema.optional(),
  billing_id: idSchema,
  patient_id: z.string().optional().default(""),
  // All date columns are normalised into ISO YYYY-MM-DD so dashboard /
  // reports queries that use `gte('date', start).lt('date', end)` produce
  // accurate aggregates regardless of which client wrote the row.
  date: optionalIsoDate,
  type: z.string().optional().default(""),
  amount: moneySchema,
  method: z.string().optional().default(""),
  ref: z.string().optional().default(""),
  remarks: z.string().optional().default(""),
  service_type: z.string().optional().default(""),
  bill_mode: z.string().optional().default(""),
  from_date: optionalIsoDate,
  to_date: optionalIsoDate,
  paid_days: z.coerce.number().int().min(0).optional().default(0),
  paid_dates: z.array(z.string()).optional().default([]),
  deleted_at: z.string().optional(),
  deleted_by: z.string().optional(),
  created_by: z.string().optional()
});

/** Reason payload for soft-delete (audit log copy). */
export const receiptSoftDeleteSchema = z.object({
  reason: z.string().trim().max(500).optional().default("")
});
export type ReceiptSoftDeleteInput = z.infer<typeof receiptSoftDeleteSchema>;

/**
 * Service-entry row inside a duty diary slice. Mirrors the columns that
 * `hominal_replace_service_entries(p_rows)` reads.
 */
export const serviceEntryRowSchema = z.object({
  billing_id: z.string().optional().default(""),
  service_name: z.string().optional().default(""),
  partner: z.string().optional().default(""),
  partner_id: z.string().optional().default(""),
  // Auto-normalised to ISO YYYY-MM-DD so per-month dashboard / report
  // aggregates stay accurate across every code path that writes service
  // entries (legacy duty-diary save, the duty-billing sync hook, etc.).
  date: optionalIsoDate,
  freq: z.string().optional().default(""),
  amt: z.coerce.number().optional().default(0),
  count: z.coerce.number().optional().default(0),
  disc: z.coerce.number().optional().default(0),
  total: z.coerce.number().optional().default(0),
  remarks: z.string().optional().default("")
});

/** POST /billings/svc-entries/replace — atomic replace by `svc_key`. */
export const replaceServiceEntriesSchema = z.object({
  svc_key: z.string().trim().min(1, "svc_key is required").max(120),
  rows: z.array(serviceEntryRowSchema).max(1000)
});
export type ReplaceServiceEntriesInput = z.infer<typeof replaceServiceEntriesSchema>;

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
