import { z } from "zod";
import { idSchema } from "@/validation/commonValidation";

const authUserDtoSchema = z.object({
  id: z.string(),
  email: z.string()
});

/** Login success payload — refresh token is HttpOnly cookie only, never in JSON. */
export const loginSessionDtoSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().optional(),
  expires_at: z.number().optional(),
  user: authUserDtoSchema.optional()
});
export type LoginSessionDto = z.infer<typeof loginSessionDtoSchema>;

/** Refresh success payload — rotated refresh token stays in HttpOnly cookie only. */
export const refreshSessionDtoSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().optional(),
  expires_at: z.number().optional()
});
export type RefreshSessionDto = z.infer<typeof refreshSessionDtoSchema>;

export const actorMeDtoSchema = z.object({
  id: idSchema,
  email: z.string(),
  username: z.string(),
  role: z.string(),
  permissions: z.array(z.string())
});
export type ActorMeDto = z.infer<typeof actorMeDtoSchema>;

export const logoutResultDtoSchema = z.object({
  revoked: z.boolean(),
  scope: z.enum(["global", "local", "others"]),
  revoke_error: z.string().nullable().optional()
});
export type LogoutResultDto = z.infer<typeof logoutResultDtoSchema>;
