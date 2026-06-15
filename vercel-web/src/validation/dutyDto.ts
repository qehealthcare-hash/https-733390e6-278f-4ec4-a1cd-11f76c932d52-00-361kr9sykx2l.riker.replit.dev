import { z } from "zod";
import { idSchema } from "@/validation/commonValidation";
import { DUTY_STATUSES } from "@/validation/dutyValidation";

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

export const dutyRowDtoSchema = z
  .object({
    id: idSchema,
    employee_id: idSchema,
    patient_id: idSchema,
    status: z.enum(DUTY_STATUSES),
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
  total: z.number().int().nonnegative()
});
export type DutyListResponseDto = z.infer<typeof dutyListResponseDtoSchema>;

export const diaryListEntryDtoSchema = z
  .object({
    date: z.string(),
    employee_id: z.string(),
    partner: z.string(),
    charge: z.number(),
    payout: z.number(),
    manual: z.boolean(),
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
