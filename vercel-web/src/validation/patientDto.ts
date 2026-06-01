import { z } from "zod";
import { idSchema } from "@/validation/commonValidation";
import { PATIENT_STATUSES } from "@/validation/patientValidation";

/**
 * Read-model contract for GET /patients/:id.
 *
 * `permissions` is the single source of truth for action gating in the UI —
 * never re-derive patient policy from raw `status`. Additive: row schema is
 * passthrough so legacy clients ignore the new field.
 */

export const patientPermissionsDtoSchema = z.object({
  canEdit: z.boolean(),
  canAssignCaretaker: z.boolean(),
  canClose: z.boolean(),
  canReopen: z.boolean(),
  canHardDelete: z.boolean(),
  blockReasons: z.record(z.string(), z.string()).optional()
});
export type PatientPermissionsDto = z.infer<typeof patientPermissionsDtoSchema>;

export const patientRowDtoSchema = z
  .object({
    id: idSchema,
    status: z.enum(PATIENT_STATUSES)
  })
  .passthrough();
export type PatientRowDto = z.infer<typeof patientRowDtoSchema>;

export const patientDetailDtoSchema = patientRowDtoSchema.extend({
  permissions: patientPermissionsDtoSchema
});
export type PatientDetailDto = z.infer<typeof patientDetailDtoSchema>;

export function parsePatientDetailDto(data: unknown) {
  return patientDetailDtoSchema.safeParse(data);
}
