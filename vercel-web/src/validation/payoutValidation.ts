import { z } from "zod";
import {
  idSchema,
  moneySchema,
  monthPeriodSchema,
  optionalIsoDate,
  positiveInt
} from "@/validation/commonValidation";

/** Lifecycle status recognised on a payout row. */
export const PAYOUT_STATUSES = ["OPEN", "LOCKED", "PAID"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/** Statuses where the payout row is locked from non-status edits. */
export const PAYOUT_CLOSED_STATUSES = new Set<PayoutStatus>(["LOCKED", "PAID"]);

/**
 * Canonical Payout payload.
 *
 * `patient_id` and `duty_ids` are *traceability* fields surfaced to audit /
 * UI breakdown. The DB row itself is keyed by `(employee_id, period_month)`
 * — duplicate prevention runs against that natural key.
 */
export const payoutSchema = z.object({
  employee_id: idSchema,
  patient_id: idSchema.optional(),
  duty_ids: z.array(idSchema).optional().default([]),
  period_month: monthPeriodSchema,
  advance: moneySchema.optional().default(0),
  deduction: moneySchema.optional().default(0),
  bonus: moneySchema.optional().default(0),
  remarks: z.string().optional().default("")
});

export const payoutAdjustmentSchema = z
  .object({
    payout_id: idSchema,
    advance: moneySchema.optional(),
    deduction: moneySchema.optional(),
    bonus: moneySchema.optional(),
    remarks: z.string().optional(),
    /**
     * Optimistic-locking guard. When provided, the service rejects with code
     * `conflict` if another user saved the payout between the client's load
     * and this save.
     */
    expected_updated_at: z.string().trim().optional()
  })
  .refine(
    (v) =>
      v.advance !== undefined ||
      v.deduction !== undefined ||
      v.bonus !== undefined ||
      v.remarks !== undefined,
    { message: "At least one of advance/deduction/bonus/remarks must be set" }
  );

export const payoutPaySchema = z.object({
  payout_id: idSchema,
  paid_on: z.string().optional(),
  method: z.string().optional().default(""),
  photo: z.string().optional().default("")
});

/** Lock a payout. */
export const payoutLockSchema = z.object({
  reason: z.string().trim().max(500).optional().default("")
});

/** Reopening a Locked payout always requires an audited reason. */
export const payoutReopenSchema = z.object({
  reason: z.string().trim().min(1, "reason is required to reopen a locked payout").max(500)
});

/** Recompute a payout from duty + attendance — RPC-driven. */
export const payoutRecomputeSchema = z.object({
  employee_id: idSchema,
  period_month: monthPeriodSchema
});

export const payoutListQuerySchema = z.object({
  limit: positiveInt.optional().default(50),
  offset: positiveInt.optional().default(0),
  q: z.string().optional().default(""),
  employee_id: z.string().optional(),
  patient_id: z.string().optional(),
  status: z.enum(PAYOUT_STATUSES).optional(),
  period: monthPeriodSchema.optional()
});

export type PayoutInput = z.infer<typeof payoutSchema>;
export type PayoutAdjustmentInput = z.infer<typeof payoutAdjustmentSchema>;
export type PayoutPayInput = z.infer<typeof payoutPaySchema>;
export type PayoutLockInput = z.infer<typeof payoutLockSchema>;
export type PayoutReopenInput = z.infer<typeof payoutReopenSchema>;
export type PayoutRecomputeInput = z.infer<typeof payoutRecomputeSchema>;
export type PayoutListQuery = z.infer<typeof payoutListQuerySchema>;

/**
 * Payout-charge row mirrors the columns
 * `hominal_replace_payout_charges(p_rows)` reads.
 */
export const payoutChargeRowSchema = z.object({
  // `date` is auto-normalised to ISO YYYY-MM-DD via `optionalIsoDate` so legacy
  // SPA strings like "9 May 2026" don't sneak back into hh_payout_charges.
  date: optionalIsoDate,
  partner: z.string().optional().default(""),
  partner_id: z.string().optional().default(""),
  term: z.string().optional().default(""),
  amount: z.coerce.number().optional().default(0),
  remarks: z.string().optional().default("")
});

/** POST /payouts/charges/replace — atomic replace by `svc_key`. */
export const replacePayoutChargesSchema = z.object({
  svc_key: z.string().trim().min(1, "svc_key is required").max(120),
  rows: z.array(payoutChargeRowSchema).max(1000)
});
export type ReplacePayoutChargesInput = z.infer<typeof replacePayoutChargesSchema>;
