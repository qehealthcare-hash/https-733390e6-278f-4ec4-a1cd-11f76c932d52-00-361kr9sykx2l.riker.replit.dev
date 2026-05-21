import { supabaseAdmin } from "../supabase";
import { env, hasOpenAI } from "../env";
import { badRequest, serverError } from "../errors";
import { audit } from "../audit";
import { newId } from "../ids";
import type { ActorContext } from "../auth";

import { type AskInput } from "@/validation/aiValidation";

export { askSchema, type AskInput } from "@/validation/aiValidation";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

interface ContextChunk {
  source: string;
  data: unknown;
}

/** Builds a small CRM context the model can ground its answer on.
 *  H2: hides billing/payout data from roles that aren't allowed to see finance. */
async function buildContext(scope: string, contextId: string | undefined, actorRole: string): Promise<ContextChunk[]> {
  const admin = supabaseAdmin();
  const chunks: ContextChunk[] = [];
  const role = (actorRole || "").toLowerCase();
  const financeAllowed = role === "admin" || role === "manager" || role === "accountant";

  if (scope === "patient" || scope === "all") {
    const today = new Date().toISOString().slice(0, 10);
    const recent = await admin
      .from("hh_patients")
      .select("id, name, phone, area, city, status, shift, caretaker_id, created_at")
      .order("created_at", { ascending: false })
      .limit(25);
    chunks.push({ source: "patients.recent", data: recent.data || [] });
    if (contextId) {
      const patient = await admin.from("hh_patients").select("*").eq("id", contextId).maybeSingle();
      if (patient.data) chunks.push({ source: `patient.${contextId}`, data: patient.data });
    }
    const noDuty = await admin
      .from("hh_patients")
      .select("id, name")
      .eq("status", "Active")
      .is("caretaker_id", null)
      .limit(20);
    chunks.push({ source: "patients.active_no_caretaker", data: noDuty.data || [], hint: today } as ContextChunk);
  }

  if ((scope === "billing" || scope === "all") && financeAllowed) {
    const billings = await admin
      .from("hh_billings")
      .select("id, patient_id, status, sec_dep, created_at")
      .eq("status", "Active")
      .order("created_at", { ascending: false })
      .limit(25);
    const receipts = await admin
      .from("hh_receipts")
      .select("id, billing_id, date, type, amount, method")
      .order("date", { ascending: false })
      .limit(50);
    chunks.push({ source: "billings.active", data: billings.data || [] });
    chunks.push({ source: "receipts.recent", data: receipts.data || [] });
  } else if (scope === "billing" && !financeAllowed) {
    chunks.push({ source: "billings.restricted", data: { reason: `role ${actorRole} cannot view finance data` } });
  }

  if (scope === "duty" || scope === "all") {
    const todayIso = new Date().toISOString();
    const upcoming = await admin
      .from("hh_duties")
      .select("id, patient_id, employee_id, shift_type, status, start_at, end_at")
      .gte("end_at", todayIso)
      .order("start_at", { ascending: true })
      .limit(40);
    const gaps = await admin
      .from("hh_duties")
      .select("id, patient_id, employee_id, shift_type, status, start_at, end_at, cancel_reason")
      .in("status", ["CANCELLED", "NO_SHOW"])
      .order("start_at", { ascending: false })
      .limit(20);
    chunks.push({ source: "duties.upcoming", data: upcoming.data || [] });
    chunks.push({ source: "duties.gaps", data: gaps.data || [] });
  }

  return chunks;
}

const SYSTEM_PROMPT = `You are the Hominal Healthcare CRM assistant.
Rules:
- Answer ONLY from the provided CRM context blocks. If the context lacks the answer, say so plainly.
- Never invent patient names, mobile numbers, amounts, or duty times.
- For sums and counts, only use values from the context.
- Be concise (max 6 short bullets). Use plain text, no markdown headings.
- For Indian currency use ₹.
`;

async function callOpenAI(messages: { role: string; content: string }[]) {
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
    throw serverError(`OpenAI ${res.status}`, text.slice(0, 500));
  }
  const json = await res.json();
  return {
    answer: json.choices?.[0]?.message?.content || "",
    usage: json.usage || null
  };
}

export const aiService = {
  async ask(input: AskInput, actor: ActorContext) {
    if (!hasOpenAI()) throw badRequest("AI is not configured (OPENAI_API_KEY missing)");
    const context = await buildContext(input.scope, input.context_id, actor.role);
    const admin = supabaseAdmin();

    const conversationId = input.conversation_id || newId.aiConv();
    if (!input.conversation_id) {
      await admin.from("hh_ai_conversations").insert({
        id: conversationId,
        actor: actor.email,
        title: input.question.slice(0, 80)
      });
    }

    const userMsgId = newId.ai();
    await admin.from("hh_ai_messages").insert({
      id: userMsgId,
      conversation_id: conversationId,
      role: "user",
      content: input.question
    });

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: "CRM context (JSON, do not echo verbatim):\n" + JSON.stringify(context) },
      { role: "user", content: input.question }
    ];
    const { answer, usage } = await callOpenAI(messages);

    const assistMsgId = newId.ai();
    await admin.from("hh_ai_messages").insert({
      id: assistMsgId,
      conversation_id: conversationId,
      role: "assistant",
      content: answer,
      citations: context.map((c) => ({ source: c.source }))
    });

    await audit(actor, {
      module: "ai",
      entityId: conversationId,
      action: "ai_query",
      payload: { scope: input.scope, model: MODEL, usage }
    });

    return {
      conversation_id: conversationId,
      answer,
      sources: context.map((c) => c.source),
      usage
    };
  },

  async listConversations(actor: ActorContext) {
    const { data, error } = await supabaseAdmin()
      .from("hh_ai_conversations")
      .select("*")
      .eq("actor", actor.email)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return data || [];
  },

  async getConversation(id: string) {
    const admin = supabaseAdmin();
    const [conv, msgs] = await Promise.all([
      admin.from("hh_ai_conversations").select("*").eq("id", id).maybeSingle(),
      admin.from("hh_ai_messages").select("*").eq("conversation_id", id).order("created_at")
    ]);
    if (conv.error) throw conv.error;
    return { conversation: conv.data, messages: msgs.data || [] };
  }
};
