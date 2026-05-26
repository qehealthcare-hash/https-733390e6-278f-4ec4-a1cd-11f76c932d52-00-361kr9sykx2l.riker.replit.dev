/**
 * AI service — orchestrates the assistant chat flow.
 *
 * Layering:
 *   - Reads CRM context via `aiRepository` (no direct Supabase).
 *   - Calls OpenAI via fetch (external API allowed in service layer).
 *   - Persists conversation + messages via `aiRepository`.
 *   - Audits via `mutationAudit.writeMutationAudit`.
 */

import type { ApiResult } from "@/types/common";
import { ErrorCodes } from "@/types/common";
import type { ServiceContext } from "@/types/serviceActor";
import {
  failure,
  notFoundFailure,
  passFailure,
  success,
  validationFailure
} from "@/utils/apiResponse";
import { env, hasOpenAI } from "@/lib/api/env";
import { newId } from "@/business/idRules";
import { aiRepository } from "@/database/aiRepository";
import { writeMutationAudit } from "@/services/mutationAudit";
import {
  askSchema,
  type AskInput
} from "@/validation/aiValidation";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const SYSTEM_PROMPT = `You are the Hominal Healthcare CRM assistant.
Rules:
- Answer ONLY from the provided CRM context blocks. If the context lacks the answer, say so plainly.
- Never invent patient names, mobile numbers, amounts, or duty times.
- For sums and counts, only use values from the context.
- Be concise (max 6 short bullets). Use plain text, no markdown headings.
- For Indian currency use ₹.
`;

interface ContextChunk {
  source: string;
  data: unknown;
  hint?: string;
}

async function buildContext(
  scope: AskInput["scope"],
  contextId: string | undefined,
  actorRole: string
): Promise<ApiResult<ContextChunk[]>> {
  const chunks: ContextChunk[] = [];
  const role = (actorRole || "").toLowerCase();
  const financeAllowed =
    role === "admin" || role === "manager" || role === "accountant";

  if (scope === "patient" || scope === "all") {
    const today = new Date().toISOString().slice(0, 10);
    const recent = await aiRepository.recentPatients();
    if (!recent.success) return passFailure(recent);
    chunks.push({ source: "patients.recent", data: recent.data });

    if (contextId) {
      const one = await aiRepository.patientById(contextId);
      if (!one.success) return passFailure(one);
      if (one.data) chunks.push({ source: `patient.${contextId}`, data: one.data });
    }

    const noDuty = await aiRepository.activePatientsWithoutCaretaker();
    if (!noDuty.success) return passFailure(noDuty);
    chunks.push({
      source: "patients.active_no_caretaker",
      data: noDuty.data,
      hint: today
    });
  }

  if ((scope === "billing" || scope === "all") && financeAllowed) {
    const billings = await aiRepository.activeBillings();
    if (!billings.success) return passFailure(billings);
    const receipts = await aiRepository.recentReceipts();
    if (!receipts.success) return passFailure(receipts);
    chunks.push({ source: "billings.active", data: billings.data });
    chunks.push({ source: "receipts.recent", data: receipts.data });
  } else if (scope === "billing" && !financeAllowed) {
    chunks.push({
      source: "billings.restricted",
      data: { reason: `role ${actorRole} cannot view finance data` }
    });
  }

  if (scope === "duty" || scope === "all") {
    const upcoming = await aiRepository.upcomingDuties();
    if (!upcoming.success) return passFailure(upcoming);
    const gaps = await aiRepository.dutyGaps();
    if (!gaps.success) return passFailure(gaps);
    chunks.push({ source: "duties.upcoming", data: upcoming.data });
    chunks.push({ source: "duties.gaps", data: gaps.data });
  }

  return success(chunks);
}

async function callOpenAI(
  messages: { role: string; content: string }[]
): Promise<ApiResult<{ answer: string; usage: unknown }>> {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.openaiApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.2,
        max_tokens: 700
      })
    });
    if (!res.ok) {
      const text = await res.text();
      return failure(`OpenAI ${res.status}`, ErrorCodes.upstream, {
        status: res.status,
        body: text.slice(0, 500)
      });
    }
    const json = await res.json();
    return success({
      answer: json.choices?.[0]?.message?.content || "",
      usage: json.usage || null
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "OpenAI call failed";
    return failure(message, ErrorCodes.upstream);
  }
}

export interface AskResult {
  conversation_id: string;
  answer: string;
  sources: string[];
  usage: unknown;
}

export const aiService = {
  async ask(input: unknown, ctx: ServiceContext): Promise<ApiResult<AskResult>> {
    if (!hasOpenAI()) {
      return failure(
        "AI is not configured (OPENAI_API_KEY missing)",
        ErrorCodes.badRequest
      );
    }

    const parsed = askSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error.flatten());

    const context = await buildContext(
      parsed.data.scope,
      parsed.data.context_id,
      ctx.actor.role || ""
    );
    if (!context.success) return passFailure(context);
    const chunks = context.data ?? [];

    const conversationId = parsed.data.conversation_id || newId.aiConv();
    if (parsed.data.conversation_id) {
      const existing = await aiRepository.findConversation(parsed.data.conversation_id);
      if (!existing.success) return passFailure(existing);
      if (!existing.data) return notFoundFailure("Conversation", parsed.data.conversation_id);
      const owner = String(existing.data.actor || existing.data.user_email || "").toLowerCase();
      const caller = String(ctx.actor.email || "").toLowerCase();
      const role = String(ctx.actor.role || "").toLowerCase();
      if (owner && caller && owner !== caller && role !== "admin" && role !== "manager") {
        return failure("Conversation not found", ErrorCodes.forbidden);
      }
    } else {
      const created = await aiRepository.insertConversation({
        id: conversationId,
        actor: ctx.actor.email,
        title: parsed.data.question.slice(0, 80)
      });
      if (!created.success) return passFailure(created);
    }

    const userMsg = await aiRepository.insertMessage({
      id: newId.ai(),
      conversation_id: conversationId,
      role: "user",
      content: parsed.data.question
    });
    if (!userMsg.success) return passFailure(userMsg);

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "system",
        content: "CRM context (JSON, do not echo verbatim):\n" + JSON.stringify(chunks)
      },
      { role: "user", content: parsed.data.question }
    ];

    const reply = await callOpenAI(messages);
    if (!reply.success) return passFailure(reply);
    const replyData = reply.data;
    if (!replyData) {
      return failure("AI reply missing payload", ErrorCodes.upstream);
    }

    const assistMsg = await aiRepository.insertMessage({
      id: newId.ai(),
      conversation_id: conversationId,
      role: "assistant",
      content: replyData.answer,
      citations: chunks.map((c) => ({ source: c.source }))
    });
    if (!assistMsg.success) return passFailure(assistMsg);

    const auditResult = await writeMutationAudit(undefined, ctx.actor, {
      module: "ai",
      entity_id: conversationId,
      action: "ai_query",
      payload: {
        scope: parsed.data.scope,
        model: MODEL,
        usage: replyData.usage
      }
    });
    if (!auditResult.success) return passFailure(auditResult);

    return success({
      conversation_id: conversationId,
      answer: replyData.answer,
      sources: chunks.map((c) => c.source),
      usage: replyData.usage
    });
  },

  async listConversations(
    ctx: ServiceContext
  ): Promise<ApiResult<Array<Record<string, unknown>>>> {
    const result = await aiRepository.listConversationsForActor(ctx.actor.email);
    if (!result.success) return passFailure(result);
    return success(result.data ?? []);
  },

  async getConversation(
    id: string,
    ctx: ServiceContext
  ): Promise<
    ApiResult<{
      conversation: Record<string, unknown> | null;
      messages: Array<Record<string, unknown>>;
    }>
  > {
    const [conv, msgs] = await Promise.all([
      aiRepository.findConversation(id),
      aiRepository.listMessages(id)
    ]);
    if (!conv.success) return passFailure(conv);
    if (!conv.data) return notFoundFailure("Conversation", id);
    const owner = String(conv.data.actor || conv.data.user_email || "").toLowerCase();
    const caller = String(ctx.actor.email || "").toLowerCase();
    const role = String(ctx.actor.role || "").toLowerCase();
    if (owner && caller && owner !== caller && role !== "admin" && role !== "manager") {
      return failure("Conversation not found", ErrorCodes.forbidden);
    }
    if (!msgs.success) return passFailure(msgs);
    return success({ conversation: conv.data, messages: msgs.data ?? [] });
  }
};
