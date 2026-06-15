import { z } from "zod";
import { idSchema } from "@/validation/commonValidation";
import { EMPLOYEE_STATUSES } from "@/validation/employeeValidation";

/**
 * Read-model contract for GET /employees/:id.
 *
 * `permissions` is the single source of truth for action gating in the UI;
 * never re-derive policy from raw `status` / `leave_date`. The row schema
 * is `passthrough()` so legacy clients ignore the new field.
 */

export const employeePermissionsDtoSchema = z.object({
  canEdit: z.boolean(),
  canDeactivate: z.boolean(),
  canActivate: z.boolean(),
  canChangeStatus: z.boolean(),
  canHardDelete: z.boolean(),
  blockReasons: z.record(z.string(), z.string()).optional()
});
export type EmployeePermissionsDto = z.infer<typeof employeePermissionsDtoSchema>;

export const employeeRowDtoSchema = z
  .object({
    id: idSchema,
    status: z.enum(EMPLOYEE_STATUSES)
  })
  .passthrough();
export type EmployeeRowDto = z.infer<typeof employeeRowDtoSchema>;

export const employeeDetailDtoSchema = employeeRowDtoSchema.extend({
  permissions: employeePermissionsDtoSchema
});
export type EmployeeDetailDto = z.infer<typeof employeeDetailDtoSchema>;

export const employeeListResponseDtoSchema = z.object({
  rows: z.array(employeeDetailDtoSchema),
  total: z.number().int().nonnegative()
});
export type EmployeeListResponseDto = z.infer<typeof employeeListResponseDtoSchema>;

export const employeeDeleteResultDtoSchema = employeeDetailDtoSchema.extend({
  mode: z.enum(["soft", "hard"])
});
export type EmployeeDeleteResultDto = z.infer<typeof employeeDeleteResultDtoSchema>;

export const employeeLinkCountsDtoSchema = z.object({
  duties: z.number().int().nonnegative(),
  attendance: z.number().int().nonnegative(),
  payouts: z.number().int().nonnegative(),
  caretakerOf: z.number().int().nonnegative()
});
export type EmployeeLinkCountsDto = z.infer<typeof employeeLinkCountsDtoSchema>;

export function parseEmployeeDetailDto(data: unknown) {
  return employeeDetailDtoSchema.safeParse(data);
}
