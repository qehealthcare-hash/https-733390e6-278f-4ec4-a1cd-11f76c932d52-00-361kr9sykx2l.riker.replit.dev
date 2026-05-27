import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { ExamRow } from "@/lib/exams/admin-data";
import type { ExamStatus } from "@/lib/database.types";

export type PublicExam = ExamRow & {
  registration_count: number;
  question_count: number;
};

const PUBLIC_STATUSES: ExamStatus[] = [
  "scheduled",
  "live",
  "closed",
  "merit_published",
  "archived",
];

const UPCOMING_STATUSES: ExamStatus[] = ["scheduled", "live"];
const PAST_STATUSES: ExamStatus[] = ["closed", "merit_published", "archived"];

export async function listPublicExams(
  filter: "upcoming" | "past" | "merit" = "upcoming",
): Promise<PublicExam[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = await createClient();
  if (!supabase) return [];

  let statusFilter: ExamStatus[];
  if (filter === "upcoming") statusFilter = UPCOMING_STATUSES;
  else if (filter === "past") statusFilter = PAST_STATUSES;
  else statusFilter = ["merit_published"];

  const { data: exams, error } = await supabase
    .from("exams")
    .select("*")
    .in("status", statusFilter)
    .order("starts_at", { ascending: filter === "past" || filter === "merit" ? false : true });

  if (error || !exams) {
    console.error("[exams] listPublic", error?.message);
    return [];
  }

  return enrichExams(exams);
}

export async function getPublicExamBySlug(slug: string): Promise<PublicExam | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = await createClient();
  if (!supabase) return null;

  const { data: exam, error } = await supabase
    .from("exams")
    .select("*")
    .eq("slug", slug)
    .in("status", PUBLIC_STATUSES)
    .maybeSingle();

  if (error || !exam) {
    if (error) console.error("[exams] getBySlug", error.message);
    return null;
  }

  const [enriched] = await enrichExams([exam]);
  return enriched ?? null;
}

export async function getPublicExamSlugs(): Promise<string[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("exams")
    .select("slug")
    .in("status", PUBLIC_STATUSES);

  if (error || !data) return [];
  return data.map((r) => r.slug);
}

/** Next scheduled exam for home hero fallbacks. */
export async function getFeaturedUpcomingExam(): Promise<PublicExam | null> {
  const upcoming = await listPublicExams("upcoming");
  return upcoming[0] ?? null;
}

export async function isUserRegistered(
  examId: string,
  userId: string,
): Promise<boolean> {
  const supabase = await createClient();
  if (!supabase) return false;

  const { data, error } = await supabase
    .from("exam_registrations")
    .select("id")
    .eq("exam_id", examId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return false;
  return Boolean(data);
}

export function isRegistrationOpen(exam: PublicExam, now = new Date()): boolean {
  if (exam.status !== "scheduled") return false;
  const t = now.getTime();
  return (
    t >= new Date(exam.registration_opens_at).getTime() &&
    t <= new Date(exam.registration_closes_at).getTime()
  );
}

export function formatExamScheduleIST(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

async function enrichExams(exams: ExamRow[]): Promise<PublicExam[]> {
  if (exams.length === 0) return [];

  const supabase = await createClient();
  if (!supabase) return exams.map((e) => ({ ...e, registration_count: 0, question_count: 0 }));

  const ids = exams.map((e) => e.id);

  const { data: stats } = await supabase
    .from("exam_public_stats")
    .select("exam_id, registration_count, question_count")
    .in("exam_id", ids);

  const statsMap = new Map(
    (stats ?? []).map((s) => [
      s.exam_id,
      {
        registration_count: s.registration_count,
        question_count: s.question_count,
      },
    ]),
  );

  return exams.map((exam) => {
    const s = statsMap.get(exam.id);
    return {
      ...exam,
      registration_count: s?.registration_count ?? 0,
      question_count: s?.question_count ?? 0,
    };
  });
}
