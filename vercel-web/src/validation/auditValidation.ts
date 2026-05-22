import { z } from "zod";
import { positiveInt } from "@/validation/commonValidation";

export const auditListQuerySchema = z.object({
  limit: positiveInt.optional().default(100),
  offset: positiveInt.optional().default(0),
  module: z.string().trim().max(40).optional(),
  entity_id: z.string().trim().max(80).optional(),
  action: z.string().trim().max(40).optional()
});

export type AuditListQuery = z.infer<typeof auditListQuerySchema>;
