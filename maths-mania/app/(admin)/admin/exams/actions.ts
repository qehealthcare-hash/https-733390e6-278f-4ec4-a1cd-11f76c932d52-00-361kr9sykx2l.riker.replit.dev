"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/guard";
import {
  parseIstDatetimeLocal,
  parseOptions,
  slugify,
} from "@/lib/exams/format";
import type { ExamDifficulty, ExamPillar, ExamStatus } from "@/lib/database.types";

export type ActionState = { error?: string; ok?: boolean };

const PILLARS: ExamPillar[] = ["school", "banking", "ssc", "tricks", "mixed"];
const DIFFICULTIES: ExamDifficulty[] = ["easy", "medium", "hard"];
const STATUSES: ExamStatus[] = [
  "draft",
  "scheduled",
  "live",
  "closed",
  "merit_published",
  "archived",
];

type ParsedExam = {
  title: string;
  slug: string;
  description: string | null;
  pillar: ExamPillar;
  difficulty: ExamDifficulty;
  duration_min: number;
  total_marks: number;
  marking_correct: number;
  marking_wrong: number;
  marking_skip: number;
  status: ExamStatus;
  starts_at: string;
  ends_at: string;
  registration_opens_at: string;
  registration_closes_at: string;
  rules_md: string | null;
  is_free: boolean;
  price_inr: number;
  merit_publish_at: null;
  syllabus: null;
  cover_image_url: null;
};

function parseExamForm(formData: FormData): { error: string } | { data: ParsedExam } {
  const title = String(formData.get("title") ?? "").trim();
  const slugRaw = String(formData.get("slug") ?? "").trim();
  const slug = slugRaw || slugify(title);
  const description = String(formData.get("description") ?? "").trim() || null;
  const pillar = String(formData.get("pillar") ?? "banking") as ExamPillar;
  const difficulty = String(formData.get("difficulty") ?? "medium") as ExamDifficulty;
  const durationMin = Number(formData.get("durationMin"));
  const totalMarks = Number(formData.get("totalMarks"));
  const markingCorrect = Number(formData.get("markingCorrect"));
  const markingWrong = Number(formData.get("markingWrong"));
  const markingSkip = Number(formData.get("markingSkip"));
  const status = String(formData.get("status") ?? "draft") as ExamStatus;
  const startsAt = parseIstDatetimeLocal(String(formData.get("startsAt") ?? ""));
  const endsAt = parseIstDatetimeLocal(String(formData.get("endsAt") ?? ""));
  const regOpens = parseIstDatetimeLocal(String(formData.get("registrationOpensAt") ?? ""));
  const regCloses = parseIstDatetimeLocal(String(formData.get("registrationClosesAt") ?? ""));
  const rulesMd = String(formData.get("rulesMd") ?? "").trim() || null;
  const isFree = formData.get("isFree") === "on";

  if (!title || !slug) return { error: "Title and slug are required." };
  if (!PILLARS.includes(pillar)) return { error: "Invalid pillar." };
  if (!DIFFICULTIES.includes(difficulty)) return { error: "Invalid difficulty." };
  if (!STATUSES.includes(status)) return { error: "Invalid status." };
  if (!Number.isFinite(durationMin) || durationMin < 1) {
    return { error: "Duration must be at least 1 minute." };
  }
  if (!Number.isFinite(totalMarks) || totalMarks < 1) {
    return { error: "Total marks must be at least 1." };
  }
  if (!startsAt || !endsAt || !regOpens || !regCloses) {
    return { error: "All schedule datetimes are required (IST)." };
  }

  return {
    data: {
      title,
      slug,
      description,
      pillar,
      difficulty,
      duration_min: durationMin,
      total_marks: totalMarks,
      marking_correct: markingCorrect,
      marking_wrong: markingWrong,
      marking_skip: markingSkip,
      status,
      starts_at: startsAt,
      ends_at: endsAt,
      registration_opens_at: regOpens,
      registration_closes_at: regCloses,
      rules_md: rulesMd,
      is_free: isFree,
      price_inr: 0,
      merit_publish_at: null,
      syllabus: null,
      cover_image_url: null,
    },
  };
}

export async function createExam(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { user } = await requireAdmin();
  const parsed = parseExamForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  const supabase = await createClient();
  if (!supabase) return { error: "Database not configured." };

  const { data, error } = await supabase
    .from("exams")
    .insert({ ...parsed.data, created_by: user.id })
    .select("id")
    .single();

  if (error) {
    console.error("[admin] createExam", error.message);
    return { error: error.message.includes("unique") ? "Slug already exists." : "Could not create exam." };
  }

  revalidatePath("/admin/exams");
  redirect(`/admin/exams/${data.id}`);
}

export async function updateExam(
  examId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const parsed = parseExamForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  const supabase = await createClient();
  if (!supabase) return { error: "Database not configured." };

  const { error } = await supabase
    .from("exams")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", examId);

  if (error) {
    console.error("[admin] updateExam", error.message);
    return { error: "Could not update exam." };
  }

  revalidatePath("/admin/exams");
  revalidatePath(`/admin/exams/${examId}`);
  return { ok: true };
}

export async function deleteExam(examId: string): Promise<ActionState> {
  await requireAdmin();
  const supabase = await createClient();
  if (!supabase) return { error: "Database not configured." };

  const { error } = await supabase.from("exams").delete().eq("id", examId);
  if (error) {
    console.error("[admin] deleteExam", error.message);
    return { error: "Could not delete exam." };
  }

  revalidatePath("/admin/exams");
  redirect("/admin/exams");
}

export async function addQuestion(
  examId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const questionLatex = String(formData.get("questionLatex") ?? "").trim();
  const explanationLatex = String(formData.get("explanationLatex") ?? "").trim() || null;
  const section = String(formData.get("section") ?? "").trim() || null;
  const topic = String(formData.get("topic") ?? "").trim() || null;
  const correctIdx = Number(formData.get("correctIdx"));
  const options = parseOptions([
    String(formData.get("option0") ?? ""),
    String(formData.get("option1") ?? ""),
    String(formData.get("option2") ?? ""),
    String(formData.get("option3") ?? ""),
  ]);

  if (!questionLatex) return { error: "Question LaTeX is required." };
  if (options.length < 4) return { error: "All four options are required." };
  if (!Number.isInteger(correctIdx) || correctIdx < 0 || correctIdx > 3) {
    return { error: "Select the correct option (A–D)." };
  }

  const supabase = await createClient();
  if (!supabase) return { error: "Database not configured." };

  const { data: maxRow } = await supabase
    .from("exam_questions")
    .select("position")
    .eq("exam_id", examId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const position = (maxRow?.position ?? 0) + 1;

  const { error } = await supabase.from("exam_questions").insert({
    exam_id: examId,
    position,
    section,
    topic,
    question_latex: questionLatex,
    options,
    correct_idx: correctIdx,
    explanation_latex: explanationLatex,
    marks_correct: null,
    marks_wrong: null,
  });

  if (error) {
    console.error("[admin] addQuestion", error.message);
    return { error: "Could not add question." };
  }

  revalidatePath(`/admin/exams/${examId}`);
  return { ok: true };
}

export async function deleteQuestion(
  examId: string,
  questionId: string,
): Promise<ActionState> {
  await requireAdmin();
  const supabase = await createClient();
  if (!supabase) return { error: "Database not configured." };

  const { error } = await supabase
    .from("exam_questions")
    .delete()
    .eq("id", questionId)
    .eq("exam_id", examId);

  if (error) {
    console.error("[admin] deleteQuestion", error.message);
    return { error: "Could not delete question." };
  }

  revalidatePath(`/admin/exams/${examId}`);
  return { ok: true };
}
