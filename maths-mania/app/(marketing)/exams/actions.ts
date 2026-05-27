"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import { getPublicExamBySlug, isRegistrationOpen } from "@/lib/exams/public";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export type RegisterState = {
  error?: string;
  ok?: boolean;
  message?: string;
};

export async function registerForExam(
  slug: string,
  prev: RegisterState,
): Promise<RegisterState> {
  void prev;
  if (!isSupabaseConfigured()) {
    return { error: "Registration is not available right now." };
  }

  const user = await getUser();
  if (!user) {
    return { error: "SIGN_IN_REQUIRED" };
  }

  const exam = await getPublicExamBySlug(slug);
  if (!exam) {
    return { error: "Exam not found." };
  }

  if (!isRegistrationOpen(exam)) {
    return { error: "Registration is closed for this exam." };
  }

  const supabase = await createClient();
  if (!supabase) {
    return { error: "Database not configured." };
  }

  const { error } = await supabase.from("exam_registrations").insert({
    exam_id: exam.id,
    user_id: user.id,
    reminder_sent_24h: false,
    reminder_sent_1h: false,
  });

  if (error) {
    if (error.code === "23505") {
      return { ok: true, message: "You are already registered." };
    }
    console.error("[registerForExam]", error.message);
    return { error: "Could not complete registration. Try again." };
  }

  revalidatePath("/exams");
  revalidatePath(`/exams/${slug}`);
  return { ok: true, message: "Seat reserved! See you in the lobby at start time." };
}
