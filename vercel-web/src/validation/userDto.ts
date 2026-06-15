import { z } from "zod";
import { idSchema } from "@/validation/commonValidation";

export const userRowDtoSchema = z
  .object({
    id: idSchema,
    username: z.string()
  })
  .passthrough();
export type UserRowDto = z.infer<typeof userRowDtoSchema>;

export const userListResponseDtoSchema = z.object({
  rows: z.array(userRowDtoSchema),
  total: z.number().int().nonnegative()
});
export type UserListResponseDto = z.infer<typeof userListResponseDtoSchema>;

export const userDeactivateResultDtoSchema = z.object({
  id: idSchema,
  deactivated: z.literal(true)
});
export type UserDeactivateResultDto = z.infer<typeof userDeactivateResultDtoSchema>;

export const roleRowDtoSchema = z
  .object({
    id: idSchema,
    name: z.string()
  })
  .passthrough();
export type RoleRowDto = z.infer<typeof roleRowDtoSchema>;

export const roleListResponseDtoSchema = z.object({
  rows: z.array(roleRowDtoSchema),
  total: z.number().int().nonnegative()
});
export type RoleListResponseDto = z.infer<typeof roleListResponseDtoSchema>;

export const roleDeleteResultDtoSchema = z.object({
  id: idSchema,
  deleted: z.literal(true)
});
export type RoleDeleteResultDto = z.infer<typeof roleDeleteResultDtoSchema>;
