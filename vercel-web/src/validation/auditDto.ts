import { z } from "zod";
import { idSchema } from "@/validation/commonValidation";

export const auditRowDtoSchema = z
  .object({
    id: idSchema,
    module: z.string(),
    entity_id: z.string(),
    action: z.string(),
    actor: z.unknown(),
    user_id: z.string().nullable(),
    stamp: z.string().optional(),
    before: z.unknown().nullable(),
    after: z.unknown().nullable(),
    payload: z.record(z.unknown()).optional(),
    created_at: z.string().nullable()
  })
  .passthrough();
export type AuditRowDto = z.infer<typeof auditRowDtoSchema>;

export const auditListResponseDtoSchema = z.object({
  rows: z.array(auditRowDtoSchema),
  total: z.number().int().nonnegative()
});
export type AuditListResponseDto = z.infer<typeof auditListResponseDtoSchema>;
