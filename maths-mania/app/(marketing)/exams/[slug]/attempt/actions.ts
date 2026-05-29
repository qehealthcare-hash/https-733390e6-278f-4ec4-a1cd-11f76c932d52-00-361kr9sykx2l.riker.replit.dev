"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import type { Json, ViolationKind } from "@/lib/database.types";

type SaveAnswerInput = {
  attemptId: string;
  questionId: string;
  selectedIdx: number | null;
  markedForReview: boolean;
  timeSpentSec: number;
};

export type SaveAnswerResult =
  | { ok: true }
  | { ok: false; error: string };

export async function saveAnswerAction(
  input: SaveAnswerInput,
): Promise<SaveAnswerResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "AUTH_REQUIRED" };

  const supabase = await createClient();
  if (!supabase) return { ok: false, error: "SUPABASE_NOT_CONFIGURED" };

  if (
    input.selectedIdx !== null &&
    (input.selectedIdx < 0 || input.selectedIdx > 3)
  ) {
    return { ok: false, error: "INVALID_OPTION" };
  }

  const { error } = await supabase
    .from("exam_answers")
    .upsert(
      {
        attempt_id: input.attemptId,
        question_id: input.questionId,
        selected_idx: input.selectedIdx,
        marked_for_review: input.markedForReview,
        time_spent_sec: Math.max(0, Math.floor(input.timeSpentSec)),
      },
      { onConflict: "attempt_id,question_id" },
    );

  if (error) {
    console.error("[attempt] saveAnswer", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export type SubmitAttemptResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: string };

export async function submitAttemptAction(
  attemptId: string,
  autoSubmitted: boolean,
  examSlug: string,
): Promise<SubmitAttemptResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "AUTH_REQUIRED" };

  const supabase = await createClient();
  if (!supabase) return { ok: false, error: "SUPABASE_NOT_CONFIGURED" };

  const { error } = await supabase.rpc("submit_exam_attempt", {
    p_attempt_id: attemptId,
    p_auto_submitted: autoSubmitted,
  });

  if (error) {
    console.error("[attempt] submitAttempt", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, redirectTo: `/exams/${examSlug}/result` };
}

export async function submitAttemptAndRedirect(
  attemptId: string,
  examSlug: string,
): Promise<void> {
  const result = await submitAttemptAction(attemptId, false, examSlug);
  if (result.ok) redirect(result.redirectTo);
}

export type RecordViolationInput = {
  attemptId: string;
  kind: ViolationKind;
  payload?: Json | null;
};

export async function recordViolationAction(
  input: RecordViolationInput,
): Promise<{ ok: boolean }> {
  const user = await getUser();
  if (!user) return { ok: false };

  const supabase = await createClient();
  if (!supabase) return { ok: false };

  const { error } = await supabase.from("violations").insert({
    attempt_id: input.attemptId,
    kind: input.kind,
    payload: input.payload ?? null,
  });

  if (error) {
    console.error("[attempt] recordViolation", error.message);
    return { ok: false };
  }
  return { ok: true };
}
