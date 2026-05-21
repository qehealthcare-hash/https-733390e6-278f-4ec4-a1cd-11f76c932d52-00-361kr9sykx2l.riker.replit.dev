import { supabaseAdmin } from "../supabase";
import { env, hasWhatsApp } from "../env";
import { badRequest, serverError } from "../errors";
import { audit } from "../audit";
import { newId } from "../ids";
import type { ActorContext } from "../auth";

import {
  type SendTextInput,
  type SendTemplateInput,
  type SendBillInput
} from "@/validation/whatsappValidation";

export {
  sendTextSchema,
  sendTemplateSchema,
  sendBillSchema,
  type SendTextInput,
  type SendTemplateInput,
  type SendBillInput
} from "@/validation/whatsappValidation";

const TABLE = "hh_whatsapp_messages";

async function callWhatsApp(body: unknown) {
  if (!hasWhatsApp()) throw badRequest("WhatsApp is not configured (WHATSAPP_TOKEN/PHONE_NUMBER_ID missing)");
  const url = `https://graph.facebook.com/v20.0/${env.whatsappPhoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.whatsappToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok) {
    throw serverError(`WhatsApp ${res.status}`, json || text.slice(0, 500));
  }
  return json;
}

export const whatsappService = {
  async list(opts: { limit: number; offset: number; relatedModule?: string; relatedId?: string }) {
    let query = supabaseAdmin()
      .from(TABLE)
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(opts.offset, opts.offset + opts.limit - 1);
    if (opts.relatedModule) query = query.eq("related_module", opts.relatedModule);
    if (opts.relatedId) query = query.eq("related_id", opts.relatedId);
    const { data, error, count } = await query;
    if (error) throw error;
    return { rows: data || [], total: count ?? data?.length ?? 0 };
  },

  async sendText(input: SendTextInput, actor: ActorContext) {
    const id = newId.whatsapp();
    const admin = supabaseAdmin();
    await admin.from(TABLE).insert({
      id,
      direction: "OUT",
      to_number: input.to,
      from_number: env.whatsappPhoneNumberId,
      related_module: input.related_module,
      related_id: input.related_id,
      payload: { text: input.text },
      status: "QUEUED",
      created_by: actor.email
    });
    try {
      const result = await callWhatsApp({
        messaging_product: "whatsapp",
        to: input.to,
        type: "text",
        text: { preview_url: false, body: input.text }
      });
      const providerId = result?.messages?.[0]?.id || "";
      await admin
        .from(TABLE)
        .update({ status: "SENT", provider_message_id: providerId, sent_at: new Date().toISOString() })
        .eq("id", id);
      await audit(actor, { module: "whatsapp", entityId: id, action: "send", payload: { providerId } });
      return { id, provider_message_id: providerId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await admin.from(TABLE).update({ status: "FAILED", error: message }).eq("id", id);
      throw err;
    }
  },

  async sendTemplate(input: SendTemplateInput, actor: ActorContext) {
    const id = newId.whatsapp();
    const admin = supabaseAdmin();
    await admin.from(TABLE).insert({
      id,
      direction: "OUT",
      template: input.template,
      to_number: input.to,
      from_number: env.whatsappPhoneNumberId,
      related_module: input.related_module,
      related_id: input.related_id,
      payload: { template: input.template, language: input.language, components: input.components },
      status: "QUEUED",
      created_by: actor.email
    });
    try {
      const result = await callWhatsApp({
        messaging_product: "whatsapp",
        to: input.to,
        type: "template",
        template: {
          name: input.template,
          language: { code: input.language },
          components: input.components
        }
      });
      const providerId = result?.messages?.[0]?.id || "";
      await admin
        .from(TABLE)
        .update({ status: "SENT", provider_message_id: providerId, sent_at: new Date().toISOString() })
        .eq("id", id);
      await audit(actor, { module: "whatsapp", entityId: id, action: "send", payload: { providerId } });
      return { id, provider_message_id: providerId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await admin.from(TABLE).update({ status: "FAILED", error: message }).eq("id", id);
      throw err;
    }
  },

  async sendBill(input: SendBillInput, actor: ActorContext) {
    const url = input.invoice_url || `https://crm.hominalhealthcare.com/legacy-crm.html?invoice=${encodeURIComponent(input.billing_id)}`;
    const text = (input.message || `Hominal Healthcare — invoice for ${input.billing_id}: ${url}`).slice(0, 1024);
    return whatsappService.sendText(
      { to: input.to, text, related_module: "billing", related_id: input.billing_id },
      actor
    );
  },

  async recordWebhook(payload: unknown, opts?: { verified?: boolean }) {
    const admin = supabaseAdmin();
    const events = ((payload as any)?.entry || []).flatMap((e: any) => e.changes || []);
    const verifiedFlag = opts?.verified === false ? "UNVERIFIED" : "DELIVERED";
    for (const change of events) {
      const value = change?.value || {};
      const statuses = value.statuses || [];
      for (const status of statuses) {
        const providerId = status?.id || "";
        const next = (status?.status || "").toUpperCase();
        if (!providerId || !next) continue;
        await admin.from(TABLE).update({ status: next }).eq("provider_message_id", providerId);
      }
      const incoming = value.messages || [];
      for (const msg of incoming) {
        const id = newId.whatsapp();
        await admin.from(TABLE).insert({
          id,
          direction: "IN",
          from_number: msg.from || "",
          to_number: env.whatsappPhoneNumberId,
          payload: msg,
          status: verifiedFlag
        });
      }
    }
    return { ok: true, verified: opts?.verified !== false };
  }
};
