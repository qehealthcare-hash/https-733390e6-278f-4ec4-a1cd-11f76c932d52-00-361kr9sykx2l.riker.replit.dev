import { z } from "zod";
import { optionalEmail } from "@/validation/commonValidation";

const trimmed = z.preprocess(
  (v) => (v == null ? "" : String(v).trim()),
  z.string()
);

export const userCreateSchema = z
  .object({
    username: trimmed.refine((v) => v.length > 0, "username is required"),
    email: optionalEmail.optional(),
    phone: trimmed.optional(),
    role: trimmed.optional(),
    is_active: z.preprocess(
      (v) => (v === undefined ? true : Boolean(v)),
      z.boolean()
    )
  })
  .passthrough();

export const userPatchSchema = userCreateSchema.partial();

export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserPatchInput = z.infer<typeof userPatchSchema>;

/* --------------------------------- Roles -------------------------------- */

export const roleCreateSchema = z
  .object({
    name: trimmed.refine((v) => v.length > 0, "Role name is required"),
    perms: z
      .preprocess(
        (v) => (v && typeof v === "object" ? v : {}),
        z.record(z.unknown())
      )
      .optional()
      .default({})
  })
  .passthrough();

export const rolePatchSchema = z
  .object({
    name: trimmed.optional(),
    perms: z
      .preprocess(
        (v) => (v && typeof v === "object" ? v : {}),
        z.record(z.unknown())
      )
      .optional()
  })
  .passthrough();

export type RoleCreateInput = z.infer<typeof roleCreateSchema>;
export type RolePatchInput = z.infer<typeof rolePatchSchema>;
