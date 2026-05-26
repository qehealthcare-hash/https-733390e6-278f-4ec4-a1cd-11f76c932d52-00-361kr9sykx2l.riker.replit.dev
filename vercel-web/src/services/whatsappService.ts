/**
 * WhatsApp service — orchestrates outbound message sends and webhook
 * persistence via `whatsappRepository`.
 *
 * Outbound messages call the Meta Graph API directly (external HTTP is
 * acceptable in the service layer). All Supabase access goes through
 * the repository.
 */

import type { ApiResult } from "@/types/common";
import { ErrorCodes } from "@/types/common";
import type { ServiceContext } from "@/types/serviceActor";
import {
  failure,
  passFailure,
  success,
  validationFailure
} from "@/utils/apiResponse";
import { env, hasWhatsApp } from "@/lib/api/env";
import { newId } from "@/business/idRules";
import { whatsappRepository } from "@/database/whatsappRepository";
import { writeMutationAudit } from "@/services/mutationAudit";
import {
  sendBillSchema,
  sendTemplateSchema,
  sendTextSchema,
  type SendBillInput,
  type SendTemplateInput,
  type SendTextInput
} from "@/validation/whatsappValidation";

async function callWhatsApp(body: unknown): Promise<ApiResult<{
  messages?: Array<{ id?: string }>;
}>> {
  if (!hasWhatsApp()) {
    return failure(
      "WhatsApp is not configured (WHATSAPP_TOKEN/PHONE_NUMBER_ID missing)",
      ErrorCodes.badRequest
    );
  }
  try {
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
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    if (!res.ok) {
      return failure(`WhatsApp ${res.status}`, ErrorCodes.upstream, {
        status: res.status,
        body: json || text.slice(0, 500)
      });
    }
    return success(json as { messages?: Array<{ id?: string }> });
  } catch (err) {
    const message = err instanceof Error ? err.message : "WhatsApp call failed";
    return failure(message, ErrorCodes.upstream);
  }
}

export interface WhatsappListOptions {
  limit: number;
  offset: number;
  relatedModule?: string;
  relatedId?: string;
}

export interface SendResult {
  id: string;
  provider_message_id: string;
}

async function sendTextInternal(
  input: SendTextInput,
  ctx: ServiceContext
): Promise<ApiResult<SendResult>> {
  const id = newId.whatsapp();
  const inserted = await whatsappRepository.insert({
    id,
    direction: "OUT",
    to_number: input.to,
    from_number: env.whatsappPhoneNumberId,
    related_module: input.related_module,
    related_id: input.related_id,
    payload: { text: input.text },
    status: "QUEUED",
    created_by: ctx.actor.email
  });
  if (!inserted.success) return passFailure(inserted);

  const apiResult = await callWhatsApp({
    messaging_product: "whatsapp",
    to: input.to,
    type: "text",
    text: { preview_url: false, body: input.text }
  });

  if (!apiResult.success) {
    await whatsappRepository.update(id, {
      status: "FAILED",
      error: apiResult.error || "Send failed"
    });
    return passFailure(apiResult);
  }

  const providerId = apiResult.data?.messages?.[0]?.id || "";
  const updated = await whatsappRepository.update(id, {
    status: "SENT",
    provider_message_id: providerId,
    sent_at: new Date().toISOString()
  });
  if (!updated.success) return passFailure(updated);

  const auditResult = await writeMutationAudit(undefined, ctx.actor, {
    module: "whatsapp",
    entity_id: id,
    action: "send",
    payload: { providerId, to: input.to, related: input.related_module }
  });
  if (!auditResult.success) return passFailure(auditResult);

  return success({ id, provider_message_id: providerId });
}

export const whatsappService = {
  async list(
    opts: WhatsappListOptions
  ): Promise<ApiResult<{ rows: Array<Record<string, unknown>>; total: number }>> {
    const result = await whatsappRepository.list(opts);
    if (!result.success) return passFailure(result);
    return success({ rows: result.data?.rows || [], total: result.data?.total ?? 0 });
  },

  async sendText(input: unknown, ctx: ServiceContext): Promise<ApiResult<SendResult>> {
    const parsed = sendTextSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error.flatten());
    return sendTextInternal(parsed.data, ctx);
  },

  async sendTemplate(input: unknown, ctx: ServiceContext): Promise<ApiResult<SendResult>> {
    const parsed = sendTemplateSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error.flatten());

    const id = newId.whatsapp();
    const inserted = await whatsappRepository.insert({
      id,
      direction: "OUT",
      template: parsed.data.template,
      to_number: parsed.data.to,
      from_number: env.whatsappPhoneNumberId,
      related_module: parsed.data.related_module,
      related_id: parsed.data.related_id,
      payload: {
        template: parsed.data.template,
        language: parsed.data.language,
        components: parsed.data.components
      },
      status: "QUEUED",
      created_by: ctx.actor.email
    });
    if (!inserted.success) return passFailure(inserted);

    const apiResult = await callWhatsApp({
      messaging_product: "whatsapp",
      to: parsed.data.to,
      type: "template",
      template: {
        name: parsed.data.template,
        language: { code: parsed.data.language },
        components: parsed.data.components
      }
    });

    if (!apiResult.success) {
      await whatsappRepository.update(id, {
        status: "FAILED",
        error: apiResult.error || "Send failed"
      });
      return passFailure(apiResult);
    }

    const providerId = apiResult.data?.messages?.[0]?.id || "";
    const updated = await whatsappRepository.update(id, {
      status: "SENT",
      provider_message_id: providerId,
      sent_at: new Date().toISOString()
    });
    if (!updated.success) return passFailure(updated);

    const auditResult = await writeMutationAudit(undefined, ctx.actor, {
      module: "whatsapp",
      entity_id: id,
      action: "send",
      payload: { providerId, template: parsed.data.template }
    });
    if (!auditResult.success) return passFailure(auditResult);

    return success({ id, provider_message_id: providerId });
  },

  async sendBill(input: unknown, ctx: ServiceContext): Promise<ApiResult<SendResult>> {
    const parsed = sendBillSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error.flatten());
    const data: SendBillInput = parsed.data;
    const url =
      data.invoice_url ||
      `https://crm.hominalhealthcare.com/legacy-crm.html?invoice=${encodeURIComponent(
        data.billing_id
      )}`;
    const text = (data.message || `Hominal Healthcare — invoice for ${data.billing_id}: ${url}`).slice(0, 1024);
    return sendTextInternal(
      { to: data.to, text, related_module: "billing", related_id: data.billing_id },
      ctx
    );
  },

  async recordWebhook(
    payload: unknown,
    opts?: { verified?: boolean }
  ): Promise<ApiResult<{ ok: true; verified: boolean }>> {
    const events =
      ((payload as { entry?: Array<{ changes?: unknown[] }> })?.entry || [])
        .flatMap((e) => e.changes || []) as Array<{ value?: Record<string, unknown> }>;
    const verifiedFlag = opts?.verified === false ? "UNVERIFIED" : "DELIVERED";

    let statusUpdates = 0;
    let inboundInserts = 0;

    for (const change of events) {
      const value = change.value || {};
      const statuses = (value.statuses as Array<{ id?: string; status?: string }>) || [];
      for (const status of statuses) {
        const providerId = status?.id || "";
        const next = (status?.status || "").toUpperCase();
        if (!providerId || !next) continue;
        const updated = await whatsappRepository.updateByProviderId(providerId, {
          status: next
        });
        if (!updated.success) return passFailure(updated);
        statusUpdates += 1;
      }
      const incoming = (value.messages as Array<{ from?: string }>) || [];
      for (const msg of incoming) {
        const id = newId.whatsapp();
        const inserted = await whatsappRepository.insert({
          id,
          direction: "IN",
          from_number: msg.from || "",
          to_number: env.whatsappPhoneNumberId,
          payload: msg,
          status: verifiedFlag
        });
        if (!inserted.success) return passFailure(inserted);
        inboundInserts += 1;
      }
    }

    if (statusUpdates || inboundInserts) {
      await writeMutationAudit(undefined, "whatsapp-webhook", {
        module: "whatsapp",
        entity_id: null,
        action: "webhook",
        after: {
          verified: opts?.verified !== false,
          status_updates: statusUpdates,
          inbound_inserts: inboundInserts
        },
        stamp: `WhatsApp webhook → ${statusUpdates} status, ${inboundInserts} inbound`
      });
    }

    return success({ ok: true, verified: opts?.verified !== false });
  }
};
