/**
 * Server-only environment access.
 *
 * Set these in Vercel → Project Settings → Environment Variables:
 *   SUPABASE_URL                  (e.g. https://hkyjxdmkqkydnrafhpgn.supabase.co)
 *   SUPABASE_SERVICE_ROLE_KEY     Service role key — keep server-side only
 *   SUPABASE_ANON_KEY             Anon key (also exposed as NEXT_PUBLIC_*)
 *   OPENAI_API_KEY                Server-only OpenAI key
 *   WHATSAPP_TOKEN                Meta WhatsApp Cloud API token
 *   WHATSAPP_PHONE_NUMBER_ID      Meta WhatsApp phone-number id
 *   API_AUDIT_DISABLED            'true' to disable audit writes (CI only)
 */

const FALLBACK_SUPABASE_URL = "https://hkyjxdmkqkydnrafhpgn.supabase.co";

function required(name: string, value: string | undefined, fallback?: string): string {
  if (value && value.length > 0) return value;
  if (fallback) return fallback;
  throw new Error(`Missing required server env: ${name}`);
}

export const env = {
  supabaseUrl: required("SUPABASE_URL", process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, FALLBACK_SUPABASE_URL),
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  whatsappToken: process.env.WHATSAPP_TOKEN || "",
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
  whatsappAppSecret: process.env.WHATSAPP_APP_SECRET || "",
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "",
  auditDisabled: (process.env.API_AUDIT_DISABLED || "").toLowerCase() === "true"
};

export function hasOpenAI(): boolean { return !!env.openaiApiKey; }
export function hasWhatsApp(): boolean { return !!(env.whatsappToken && env.whatsappPhoneNumberId); }
