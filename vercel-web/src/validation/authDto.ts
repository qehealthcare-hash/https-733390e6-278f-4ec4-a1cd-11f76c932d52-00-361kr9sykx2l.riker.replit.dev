import { z } from "zod";
import { idSchema } from "@/validation/commonValidation";

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
