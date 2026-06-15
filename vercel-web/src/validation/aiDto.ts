import { z } from "zod";
import { idSchema } from "@/validation/commonValidation";

export const aiAskResultDtoSchema = z.object({
  conversation_id: idSchema,
  answer: z.string(),
  sources: z.array(z.string()),
  usage: z.unknown().nullable()
});
export type AiAskResultDto = z.infer<typeof aiAskResultDtoSchema>;

export const aiConversationRowDtoSchema = z.record(z.unknown());
export const aiConversationListDtoSchema = z.array(aiConversationRowDtoSchema);
export type AiConversationListDto = z.infer<typeof aiConversationListDtoSchema>;

export const aiConversationDetailDtoSchema = z.object({
  conversation: aiConversationRowDtoSchema.nullable(),
  messages: z.array(aiConversationRowDtoSchema)
});
export type AiConversationDetailDto = z.infer<typeof aiConversationDetailDtoSchema>;
