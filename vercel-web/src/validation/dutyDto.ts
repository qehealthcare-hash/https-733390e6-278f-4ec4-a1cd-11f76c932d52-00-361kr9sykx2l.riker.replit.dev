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
