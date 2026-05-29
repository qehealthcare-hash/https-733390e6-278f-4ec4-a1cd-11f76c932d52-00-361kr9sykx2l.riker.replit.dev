import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { Database } from "@/lib/database.types";

export type ExamRow = Database["public"]["Tables"]["exams"]["Row"];
export type QuestionRow = Database["public"]["Tables"]["exam_questions"]["Row"];

export async function listExamsForAdmin(): Promise<ExamRow[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("exams")
    .select("*")
    .order("starts_at", { ascending: false });

  if (error) {
    console.error("[admin] listExams", error.message);
    return [];
  }
  return data ?? [];
}

export async function getExamById(id: string): Promise<ExamRow | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("exams")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[admin] getExam", error.message);
    return null;
  }
  return data;
}

export async function getQuestionsForExam(examId: string): Promise<QuestionRow[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("exam_questions")
    .select("*")
    .eq("exam_id", examId)
    .order("position", { ascending: true });

  if (error) {
    console.error("[admin] listQuestions", error.message);
    return [];
  }
  return data ?? [];
}

export function optionsFromJson(json: unknown): string[] {
  if (!Array.isArray(json)) return ["", "", "", ""];
  return json.map((v) => (typeof v === "string" ? v : String(v)));
}
