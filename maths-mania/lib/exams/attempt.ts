import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { Database } from "@/lib/database.types";
import { optionsFromJson } from "@/lib/exams/admin-data";

/** Question payload safe to send to the client (no correct_idx / explanation). */
export type AttemptQuestion = {
  id: string;
  position: number;
  section: string | null;
  topic: string | null;
  question_latex: string;
  options: string[];
  marks_correct: number | null;
  marks_wrong: number | null;
};

/** Snapshot of a stored answer used to hydrate the player on resume. */
export type AttemptAnswerSnapshot = {
  question_id: string;
  selected_idx: number | null;
  marked_for_review: boolean;
  time_spent_sec: number;
};

export type AttemptScorecard = {
  raw_score: number;
  final_score: number;
  correct_count: number;
  incorrect_count: number;
  unattempted_count: number;
  total_questions: number;
};

export type AttemptRow = Database["public"]["Tables"]["exam_attempts"]["Row"];

export type AttemptBootstrap = {
  attempt_id: string;
  started_at: string;
  exam_ends_at: string;
  server_now: string;
};

export type StartAttemptReason =
  | "AUTH_REQUIRED"
  | "EXAM_NOT_FOUND"
  | "EXAM_NOT_STARTED"
  | "EXAM_ENDED"
  | "NOT_REGISTERED"
  | "ATTEMPT_FINISHED"
  | "SUPABASE_NOT_CONFIGURED"
  | "UNKNOWN";

export type StartAttemptResult =
  | { ok: true; data: AttemptBootstrap }
  | { ok: false; reason: StartAttemptReason; message?: string };

const KNOWN_REASONS: readonly StartAttemptReason[] = [
  "AUTH_REQUIRED",
  "EXAM_NOT_FOUND",
  "EXAM_NOT_STARTED",
  "EXAM_ENDED",
  "NOT_REGISTERED",
  "ATTEMPT_FINISHED",
];

function parseRpcError(message: string | null | undefined): StartAttemptReason {
  if (!message) return "UNKNOWN";
  for (const r of KNOWN_REASONS) {
    if (message.includes(r)) return r;
  }
  return "UNKNOWN";
}

export async function startAttempt(examId: string): Promise<StartAttemptResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, reason: "SUPABASE_NOT_CONFIGURED" };
  }

  const supabase = await createClient();
  if (!supabase) {
    return { ok: false, reason: "SUPABASE_NOT_CONFIGURED" };
  }

  const { data, error } = await supabase.rpc("start_exam_attempt", {
    p_exam_id: examId,
  });

  if (error) {
    const reason = parseRpcError(error.message);
    return { ok: false, reason, message: error.message };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return { ok: false, reason: "UNKNOWN" };
  }

  return {
    ok: true,
    data: {
      attempt_id: row.attempt_id,
      started_at: row.started_at,
      exam_ends_at: row.exam_ends_at,
      server_now: row.server_now,
    },
  };
}

export async function getAttemptForUser(
  examId: string,
  userId: string,
): Promise<AttemptRow | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("exam_attempts")
    .select("*")
    .eq("exam_id", examId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[attempt] getAttemptForUser", error.message);
    return null;
  }
  return data;
}

export async function listUserAttempts(userId: string): Promise<AttemptRow[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("exam_attempts")
    .select("*")
    .eq("user_id", userId)
    .order("started_at", { ascending: false });

  if (error) {
    console.error("[attempt] listUserAttempts", error.message);
    return [];
  }
  return data ?? [];
}

export async function getAttemptQuestions(
  examId: string,
): Promise<AttemptQuestion[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("exam_questions")
    .select(
      "id, position, section, topic, question_latex, options, marks_correct, marks_wrong",
    )
    .eq("exam_id", examId)
    .order("position", { ascending: true });

  if (error) {
    console.error("[attempt] getAttemptQuestions", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    position: row.position,
    section: row.section,
    topic: row.topic,
    question_latex: row.question_latex,
    options: optionsFromJson(row.options),
    marks_correct: row.marks_correct,
    marks_wrong: row.marks_wrong,
  }));
}

export async function getAttemptAnswers(
  attemptId: string,
): Promise<AttemptAnswerSnapshot[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("exam_answers")
    .select("question_id, selected_idx, marked_for_review, time_spent_sec")
    .eq("attempt_id", attemptId);

  if (error) {
    console.error("[attempt] getAttemptAnswers", error.message);
    return [];
  }
  return data ?? [];
}

export async function getAttemptScorecard(
  attemptRow: AttemptRow,
  totalQuestions: number,
): Promise<AttemptScorecard | null> {
  if (attemptRow.status === "in_progress") return null;
  const supabase = await createClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("exam_answers")
    .select("is_correct, selected_idx")
    .eq("attempt_id", attemptRow.id);

  if (error) {
    console.error("[attempt] getAttemptScorecard", error.message);
    return null;
  }

  const rows = data ?? [];
  const correct = rows.filter((r) => r.is_correct === true).length;
  const incorrect = rows.filter(
    (r) => r.selected_idx !== null && r.is_correct === false,
  ).length;
  const unattempted = Math.max(0, totalQuestions - correct - incorrect);

  return {
    raw_score: Number(attemptRow.raw_score ?? 0),
    final_score: Number(attemptRow.final_score ?? 0),
    correct_count: correct,
    incorrect_count: incorrect,
    unattempted_count: unattempted,
    total_questions: totalQuestions,
  };
}
