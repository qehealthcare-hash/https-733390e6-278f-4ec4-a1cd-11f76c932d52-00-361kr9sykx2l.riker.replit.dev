/**
 * AI repository — `hh_ai_conversations` + `hh_ai_messages` storage and
 * read-only context queries for the assistant.
 *
 * All write operations go through the admin client because AI logging
 * runs on behalf of users that may not have direct RLS write permission
 * on these tables.
 */

import type { ApiResult } from "@/types/common";
import type { DbAccess, JsonRow } from "@/database/types";
import {
  insertRow,
  resolveClient
} from "@/database/baseRepository";
import { runListQuery, runQuery } from "@/database/supabaseClient";

const CONVOS = "hh_ai_conversations";
const MESSAGES = "hh_ai_messages";

export interface AiConversation {
  id: string;
  actor?: string;
  title?: string;
  created_at?: string;
  updated_at?: string;
}

export interface AiMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations?: unknown;
  created_at?: string;
}

export const aiRepository = {
  /* ---------------------- Context queries (read-only) --------------------- */

  async recentPatients(opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery(
      () =>
        db
          .from("hh_patients")
          .select("id, name, phone, area, city, status, shift, caretaker_id, created_at")
          .order("created_at", { ascending: false })
          .limit(25),
      "ai.recentPatients"
    );
  },

  async patientById(id: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    const db = resolveClient(opts);
    return runQuery(
      () => db.from("hh_patients").select("*").eq("id", id).maybeSingle(),
      "ai.patientById"
    );
  },

  async activePatientsWithoutCaretaker(opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery(
      () =>
        db
          .from("hh_patients")
          .select("id, name")
          .eq("status", "Active")
          .is("caretaker_id", null)
          .limit(20),
      "ai.activePatientsNoCaretaker"
    );
  },

  async activeBillings(opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery(
      () =>
        db
          .from("hh_billings")
          .select("id, patient_id, status, sec_dep, created_at")
          .eq("status", "Active")
          .order("created_at", { ascending: false })
          .limit(25),
      "ai.activeBillings"
    );
  },

  async recentReceipts(opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery(
      () =>
        db
          .from("hh_receipts")
          .select("id, billing_id, date, type, amount, method")
          .order("date", { ascending: false })
          .limit(50),
      "ai.recentReceipts"
    );
  },

  async upcomingDuties(opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    const todayIso = new Date().toISOString();
    return runListQuery(
      () =>
        db
          .from("hh_duties")
          .select("id, patient_id, employee_id, shift_type, status, start_at, end_at")
          .gte("end_at", todayIso)
          .order("start_at", { ascending: true })
          .limit(40),
      "ai.upcomingDuties"
    );
  },

  async dutyGaps(opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery(
      () =>
        db
          .from("hh_duties")
          .select(
            "id, patient_id, employee_id, shift_type, status, start_at, end_at, cancel_reason"
          )
          .in("status", ["CANCELLED", "NO_SHOW"])
          .order("start_at", { ascending: false })
          .limit(20),
      "ai.dutyGaps"
    );
  },

  /* ----------------------------- Conversations ---------------------------- */

  insertConversation(row: AiConversation): Promise<ApiResult<JsonRow | null>> {
    return insertRow(CONVOS, row as unknown as JsonRow, "ai.conv");
  },

  async listConversationsForActor(email: string): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient();
    return runListQuery(
      () =>
        db
          .from(CONVOS)
          .select("*")
          .eq("actor", email)
          .order("updated_at", { ascending: false })
          .limit(50),
      "ai.listConvs"
    );
  },

  async findConversation(id: string): Promise<ApiResult<JsonRow | null>> {
    const db = resolveClient();
    return runQuery(
      () => db.from(CONVOS).select("*").eq("id", id).maybeSingle(),
      "ai.findConv"
    );
  },

  /* ------------------------------- Messages ------------------------------- */

  insertMessage(row: AiMessage): Promise<ApiResult<JsonRow | null>> {
    return insertRow(MESSAGES, row as unknown as JsonRow, "ai.msg");
  },

  async listMessages(conversationId: string): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient();
    return runListQuery(
      () =>
        db
          .from(MESSAGES)
          .select("*")
          .eq("conversation_id", conversationId)
          .order("created_at"),
      "ai.listMsgs"
    );
  }
};
