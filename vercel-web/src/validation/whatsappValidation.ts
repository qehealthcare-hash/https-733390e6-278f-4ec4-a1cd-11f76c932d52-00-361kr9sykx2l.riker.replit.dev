import { z } from "zod";
import { idSchema, phoneSchema } from "@/validation/commonValidation";

export const sendTextSchema = z.object({
  to: phoneSchema,
  text: z.string().trim().min(1).max(4000),
  related_module: z.string().optional().default(""),
  related_id: z.string().optional().default("")
});

export const sendTemplateSchema = z.object({
  to: phoneSchema,
  template: z.string().trim().min(1),
  language: z.string().default("en"),
  components: z.array(z.unknown()).optional().default([]),
  related_module: z.string().optional().default(""),
  related_id: z.string().optional().default("")
});

export const sendBillSchema = z.object({
  to: phoneSchema,
  billing_id: idSchema,
  invoice_url: z.string().url().optional(),
  message: z.string().optional()
});

const whatsappStatusSchema = z.object({
  id: z.string().optional(),
  status: z.string().optional()
});

const whatsappInboundMessageSchema = z
  .object({
    from: z.string().optional()
  })
  .passthrough();

const whatsappChangeValueSchema = z
  .object({
    statuses: z.array(whatsappStatusSchema).optional(),
    messages: z.array(whatsappInboundMessageSchema).optional()
  })
  .passthrough();

const whatsappChangeSchema = z
  .object({
    value: whatsappChangeValueSchema.optional()
  })
  .passthrough();

const whatsappEntrySchema = z
  .object({
    changes: z.array(whatsappChangeSchema).optional()
  })
  .passthrough();

/** Meta Cloud API webhook envelope (delivery + inbound message events). */
export const whatsappWebhookPayloadSchema = z
  .object({
    entry: z.array(whatsappEntrySchema).optional()
  })
  .passthrough();

export type SendTextInput = z.infer<typeof sendTextSchema>;
export type SendTemplateInput = z.infer<typeof sendTemplateSchema>;
export type SendBillInput = z.infer<typeof sendBillSchema>;
export type WhatsAppWebhookPayload = z.infer<typeof whatsappWebhookPayloadSchema>;
