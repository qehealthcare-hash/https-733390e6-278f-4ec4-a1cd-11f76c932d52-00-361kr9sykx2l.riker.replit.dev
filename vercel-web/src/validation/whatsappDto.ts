import { z } from "zod";
import { idSchema } from "@/validation/commonValidation";

export const whatsappSendResultDtoSchema = z.object({
  id: idSchema,
  provider_message_id: z.string()
});
export type WhatsappSendResultDto = z.infer<typeof whatsappSendResultDtoSchema>;

export const whatsappMessageRowDtoSchema = z.record(z.unknown());

export const whatsappListResponseDtoSchema = z.object({
  rows: z.array(whatsappMessageRowDtoSchema),
  total: z.number().int().nonnegative()
});
export type WhatsappListResponseDto = z.infer<typeof whatsappListResponseDtoSchema>;

export const whatsappWebhookResultDtoSchema = z.object({
  ok: z.literal(true),
  verified: z.boolean()
});
export type WhatsappWebhookResultDto = z.infer<typeof whatsappWebhookResultDtoSchema>;
