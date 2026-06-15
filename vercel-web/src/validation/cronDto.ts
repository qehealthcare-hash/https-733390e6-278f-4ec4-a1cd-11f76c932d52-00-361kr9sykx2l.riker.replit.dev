import { z } from "zod";

/** Result of `hominal_bulk_materialize_due_duty_days` (cron materialization RPC). */
export const bulkDutyMaterializeResultDtoSchema = z.object({
  ok: z.boolean(),
  from: z.string(),
  to: z.string(),
  candidate_rows: z.number().int().nonnegative(),
  created_svc: z.number().int().nonnegative(),
  created_payout: z.number().int().nonnegative()
});
export type BulkDutyMaterializeResultDto = z.infer<typeof bulkDutyMaterializeResultDtoSchema>;

/** Result of `hominal_sync_duty_attendance_payout_ledger` (post-materialize reconciliation). */
export const dutyLedgerSyncResultDtoSchema = z.object({
  ok: z.boolean(),
  attendance: z
    .object({
      ok: z.boolean().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      inserted_attendance: z.number().int().nonnegative().optional()
    })
    .optional(),
  payout: z
    .object({
      ok: z.boolean().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      updated_payouts: z.number().int().nonnegative().optional(),
      inserted_payouts: z.number().int().nonnegative().optional(),
      payout_gross_mismatch_groups: z.number().int().nonnegative().optional(),
      attendance_charge_gap_groups: z.number().int().nonnegative().optional(),
      attendance_duplicate_groups: z.number().int().nonnegative().optional()
    })
    .optional()
});
export type DutyLedgerSyncResultDto = z.infer<typeof dutyLedgerSyncResultDtoSchema>;

/** GET /cron/duties-extend success envelope. */
export const dutiesExtendCronResultDtoSchema = z.object({
  ok: z.literal(true),
  summary: bulkDutyMaterializeResultDtoSchema.nullable(),
  ledger: dutyLedgerSyncResultDtoSchema.nullable(),
  error: z.null(),
  ranAt: z.string()
});
export type DutiesExtendCronResultDto = z.infer<typeof dutiesExtendCronResultDtoSchema>;
