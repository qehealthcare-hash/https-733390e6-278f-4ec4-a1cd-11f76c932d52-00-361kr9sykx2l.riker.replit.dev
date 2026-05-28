import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Client = SupabaseClient<Database>;

export type StartAttemptResult =
  | {
      ok: true;
      attemptId: string;
      startedAt: string;
      examEndsAt: string;
      serverNow: string;
    }
  | { ok: false; error: string; status: number };

export async function startAttemptHttp(
  supabase: Client,
  examId: string,
): Promise<StartAttemptResult> {
  const { data, error } = await supabase.rpc("start_exam_attempt", {
    p_exam_id: examId,
  });

  if (error) {
    const code = error.message;
    const status =
      code.includes("AUTH_REQUIRED") ? 401
      : code.includes("NOT_REGISTERED") ? 403
      : code.includes("EXAM_NOT_STARTED") ? 403
      : code.includes("EXAM_ENDED") ? 403
      : code.includes("ATTEMPT_FINISHED") ? 409
      : 400;
    return { ok: false, error: code, status };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return { ok: false, error: "EMPTY_RESPONSE", status: 500 };
  }

  return {
    ok: true,
    attemptId: row.attempt_id,
    startedAt: row.started_at,
    examEndsAt: row.exam_ends_at,
    serverNow: row.server_now,
  };
}

export type SaveAnswerHttpInput = {
  attemptId: string;
  questionId: string;
  selectedIdx: number | null;
  markedForReview?: boolean;
  timeSpentSec?: number;
};

export type SaveAnswerHttpResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

export async function saveAnswerHttp(
  supabase: Client,
  input: SaveAnswerHttpInput,
): Promise<SaveAnswerHttpResult> {
  if (
    input.selectedIdx !== null &&
    (input.selectedIdx < 0 || input.selectedIdx > 3)
  ) {
    return { ok: false, error: "INVALID_OPTION", status: 400 };
  }

  const { error } = await supabase.from("exam_answers").upsert(
    {
      attempt_id: input.attemptId,
      question_id: input.questionId,
      selected_idx: input.selectedIdx,
      marked_for_review: input.markedForReview ?? false,
      time_spent_sec: Math.max(0, Math.floor(input.timeSpentSec ?? 0)),
    },
    { onConflict: "attempt_id,question_id" },
  );

  if (error) {
    const status = error.code === "42501" ? 403 : 400;
    return { ok: false, error: error.message, status };
  }
  return { ok: true };
}
