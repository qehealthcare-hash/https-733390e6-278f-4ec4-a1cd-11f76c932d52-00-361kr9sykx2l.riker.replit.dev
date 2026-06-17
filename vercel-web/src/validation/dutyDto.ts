import { z } from "zod";
import { idSchema, signedMoneySchema } from "@/validation/commonValidation";

/**
 * Read-model contract for GET /duties/:id.
 *
 * The UI should consume `permissions` for action gating — never re-derive
 * duty policy from raw `status`. New fields can be added safely; the row
 * schema is `passthrough()` so existing client code stays compatible.
 */

export const dutyPermissionsDtoSchema = z.object({
  canEdit: z.boolean(),
  canCancel: z.boolean(),
  canCheckIn: z.boolean(),
  canCheckOut: z.boolean(),
  canMaterialize: z.boolean(),
  canHardDelete: z.boolean(),
  /** True when billing/payout has fully locked the duty (no editable days). */
  frozen: z.boolean().optional(),
  /** True when some days are locked but others remain editable. */
  partiallyFrozen: z.boolean().optional(),
  blockReasons: z.record(z.string(), z.string()).optional()
});
export type DutyPermissionsDto = z.infer<typeof dutyPermissionsDtoSchema>;

/** Read-model status — tolerate legacy / mixed-case values from the DB. */
const dutyReadStatusSchema = z.preprocess(
  (v) => String(v || "SCHEDULED").trim().toUpperCase(),
  z.string().min(1)
);

export const dutyRowDtoSchema = z
  .object({
    id: idSchema,
    employee_id: idSchema,
    patient_id: idSchema,
    status: dutyReadStatusSchema,
    start_at: z.string(),
    end_at: z.string().nullable().optional()
  })
  .passthrough();
export type DutyRowDto = z.infer<typeof dutyRowDtoSchema>;

export const dutyDetailDtoSchema = dutyRowDtoSchema.extend({
  permissions: dutyPermissionsDtoSchema
});
export type DutyDetailDto = z.infer<typeof dutyDetailDtoSchema>;

export function parseDutyDetailDto(data: unknown) {
  return dutyDetailDtoSchema.safeParse(data);
}

export const dutyListResponseDtoSchema = z.object({
  rows: z.array(dutyRowDtoSchema),
  total: z.coerce.number().int().nonnegative()
});
export type DutyListResponseDto = z.infer<typeof dutyListResponseDtoSchema>;

const diaryBoolSchema = z.preprocess(
  (v) => (v === true || v === "true" || v === 1 || v === "1" ? true : false),
  z.boolean()
);

export const diaryListEntryDtoSchema = z
  .object({
    date: z.string(),
    employee_id: z.string(),
    partner: z.string(),
    charge: signedMoneySchema,
    payout: signedMoneySchema,
    manual: diaryBoolSchema,
    svc_id: z.string().nullable(),
    payout_id: z.string().nullable(),
    svc_updated_at: z.string().optional(),
    payout_updated_at: z.string().optional()
  })
  .passthrough();

export const diaryListResultDtoSchema = z.object({
  duty_id: z.string(),
  entries: z.array(diaryListEntryDtoSchema),
  error: z.string().optional()
});
export type DiaryListResultDto = z.infer<typeof diaryListResultDtoSchema>;

export const diaryBatchResponseDtoSchema = z.record(z.string(), diaryListResultDtoSchema);
export type DiaryBatchResponseDto = z.infer<typeof diaryBatchResponseDtoSchema>;

/** DELETE /duties/:id?hard=1 — soft-delete acknowledgement (not a full duty row). */
export const dutyHardDeleteResponseDtoSchema = z.object({
  id: idSchema,
  deleted: z.literal(true)
});
export type DutyHardDeleteResponseDto = z.infer<typeof dutyHardDeleteResponseDtoSchema>;

/** PATCH /duties/:id/diary/:date response body. */
export const diaryDayPatchResponseDtoSchema = z.object({
  svc_updated: z.boolean(),
  payout_updated: z.boolean(),
  manual: z.boolean(),
  partner_changed: z.boolean(),
  employee_id: z.string(),
  promoted_partner: z.boolean()
});
export type DiaryDayPatchResponseDto = z.infer<typeof diaryDayPatchResponseDtoSchema>;

/** DELETE /duties/:id/diary/:date response body. */
export const diaryDayDeleteResponseDtoSchema = z.object({
  svc_deleted: z.boolean(),
  payout_deleted: z.boolean()
});
export type DiaryDayDeleteResponseDto = z.infer<typeof diaryDayDeleteResponseDtoSchema>;

const diaryRowActionDtoSchema = z.enum(["create", "update", "skip", "delete"]);

export const materializePreviewRowDtoSchema = z
  .object({
    date: z.string(),
    employee_id: z.string(),
    employee_name: z.string(),
    charge: z.number(),
    payout: z.number(),
    svc_action: diaryRowActionDtoSchema,
    payout_action: diaryRowActionDtoSchema
  })
  .passthrough();

/** POST /duties/:id/materialize response body. */
export const dutyMaterializeResultDtoSchema = z
  .object({
    billing_id: z.string(),
    svc_key: z.string(),
    created_svc: z.number().int().nonnegative(),
    created_payout: z.number().int().nonnegative(),
    updated_svc: z.number().int().nonnegative(),
    updated_payout: z.number().int().nonnegative(),
    deleted_svc: z.number().int().nonnegative(),
    deleted_payout: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    days: z.number().int().nonnegative(),
    duplicate_skipped_svc: z.number().int().nonnegative().optional(),
    duplicate_skipped_payout: z.number().int().nonnegative().optional(),
    dry_run: z.boolean().optional(),
    preview: z.array(materializePreviewRowDtoSchema).optional(),
    would_create_svc: z.number().int().nonnegative().optional(),
    would_create_payout: z.number().int().nonnegative().optional(),
    would_update_svc: z.number().int().nonnegative().optional(),
    would_update_payout: z.number().int().nonnegative().optional(),
    would_delete_svc: z.number().int().nonnegative().optional(),
    would_delete_payout: z.number().int().nonnegative().optional()
  })
  .passthrough();
export type DutyMaterializeResultDto = z.infer<typeof dutyMaterializeResultDtoSchema>;

const dutyTotalsPatientDtoSchema = z.object({
  patient_id: z.string(),
  bills: z.number().int().nonnegative(),
  billed: z.number(),
  received: z.number(),
  outstanding: z.number(),
  sec_dep: z.number()
});

const dutyTotalsPartnerDtoSchema = z.object({
  employee_id: z.string(),
  charged: z.number(),
  paid: z.number(),
  pending: z.number()
});

/** GET /duties/totals response body. */
export const dutyTotalsResponseDtoSchema = z.object({
  patient: dutyTotalsPatientDtoSchema.nullable(),
  partner: dutyTotalsPartnerDtoSchema.nullable()
});
export type DutyTotalsResponseDto = z.infer<typeof dutyTotalsResponseDtoSchema>;

/** POST /duties/extend-active response body. */
export const dutyExtendActiveResultDtoSchema = z.object({
  processed: z.number().int().nonnegative(),
  created_svc: z.number().int().nonnegative(),
  created_payout: z.number().int().nonnegative(),
  updated_svc: z.number().int().nonnegative(),
  updated_payout: z.number().int().nonnegative(),
  deleted_svc: z.number().int().nonnegative(),
  deleted_payout: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  skipped_no_bill: z.number().int().nonnegative(),
  errors: z.array(
    z.object({
      duty_id: z.string(),
      error: z.string()
    })
  )
});
export type DutyExtendActiveResultDto = z.infer<typeof dutyExtendActiveResultDtoSchema>;

/** POST /duties/:id/partners response body. */
export const dutyAssignPartnersResponseDtoSchema = z.object({
  duty: dutyDetailDtoSchema,
  materialize: dutyMaterializeResultDtoSchema.optional()
});
export type DutyAssignPartnersResponseDto = z.infer<typeof dutyAssignPartnersResponseDtoSchema>;
