import { z } from "zod";
import { idSchema, phoneSchema } from "@/validation/commonValidation";

/**
 * P1-15: WhatsApp `to` must match the org's allowed country prefix. The Meta
 * Cloud API will happily relay messages to any E.164 number — without this
 * check a leaked staff token could be used to spam international numbers on
 * our billing account. The prefix is env-configurable (default `+91` for
 * India) so test fixtures can run with a different region.
 */
const WHATSAPP_PHONE_PREFIX = String(
  process.env.WHATSAPP_PHONE_PREFIX || process.env.NEXT_PUBLIC_WHATSAPP_PHONE_PREFIX || "+91"
);

/** Canonical `+CCNNNN…` form (digits only after `+`). */
function normaliseWhatsappTo(raw: string): string {
  const digits = String(raw || "").replace(/[^0-9+]/g, "");
  if (!digits) return "";
  if (digits.startsWith("+")) return digits;
  // 10-digit raw number — assume domestic, prefix the configured country code.
  const stripped = digits.replace(/^0+/, "");
  return WHATSAPP_PHONE_PREFIX + stripped;
}

const whatsappToSchema = phoneSchema
  .transform(normaliseWhatsappTo)
  .refine((v) => v.startsWith(WHATSAPP_PHONE_PREFIX), {
    message: `WhatsApp recipient must start with ${WHATSAPP_PHONE_PREFIX} (countryPrefix)`
  });

/**
 * P1-15: `invoice_url` may only point at an org-owned host. The default list
 * keeps the Supabase signed-download host (where invoice PDFs live today).
 * Override with INVOICE_URL_HOSTS=app.hominal.com,bills.hominal.com if the
 * deploy ever proxies invoices elsewhere.
 */
const ORG_HOSTS = String(
  process.env.INVOICE_URL_HOSTS ||
    process.env.NEXT_PUBLIC_INVOICE_URL_HOSTS ||
    "hkyjxdmkqkydnrafhpgn.supabase.co,app.hominal.com"
)
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

export const invoiceUrlSchema = z
  .string()
  .url()
  .refine(
    (u) => {
      try {
        const host = new URL(u).hostname.toLowerCase();
        return ORG_HOSTS.some((h) => host === h || host.endsWith("." + h));
      } catch {
        return false;
      }
    },
    { message: "invoice_url host is not on the org allow-list (set INVOICE_URL_HOSTS)" }
  );

export const sendTextSchema = z.object({
  to: whatsappToSchema,
  text: z.string().trim().min(1).max(4000),
  related_module: z.string().optional().default(""),
  related_id: z.string().optional().default("")
});

export const sendTemplateSchema = z.object({
  to: whatsappToSchema,
  template: z.string().trim().min(1),
  language: z.string().default("en"),
  components: z.array(z.unknown()).optional().default([]),
  related_module: z.string().optional().default(""),
  related_id: z.string().optional().default("")
});

export const sendBillSchema = z.object({
  to: whatsappToSchema,
  billing_id: idSchema,
  invoice_url: invoiceUrlSchema.optional(),
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
