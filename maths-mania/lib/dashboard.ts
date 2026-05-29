import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { AttemptRow } from "@/lib/exams/attempt";
import type { ExamRow } from "@/lib/exams/admin-data";
import { listCertificatesForUser } from "@/lib/exams/certificates";

export type DashboardExamLite = Pick<
  ExamRow,
  "id" | "slug" | "title" | "starts_at" | "ends_at" | "status" | "duration_min"
>;

export type DashboardAttempt = AttemptRow & {
  exam: DashboardExamLite;
};

export type DashboardOverview = {
  stats: {
    exams_registered: number;
    attempts_completed: number;
    certificates: number;
    best_percentile: number | null;
  };
  upcoming: Array<{
    exam: DashboardExamLite;
    registered: boolean;
    attempt: AttemptRow | null;
  }>;
  recent_attempts: DashboardAttempt[];
};

export async function getDashboardOverview(
  userId: string,
): Promise<DashboardOverview> {
  const empty: DashboardOverview = {
    stats: {
      exams_registered: 0,
      attempts_completed: 0,
      certificates: 0,
      best_percentile: null,
    },
    upcoming: [],
    recent_attempts: [],
  };

  if (!isSupabaseConfigured()) return empty;
  const supabase = await createClient();
  if (!supabase) return empty;

  const [registrations, attempts, certificates] = await Promise.all([
    supabase
      .from("exam_registrations")
      .select(
        "exam:exams(id, slug, title, starts_at, ends_at, status, duration_min)",
      )
      .eq("user_id", userId),
    supabase
      .from("exam_attempts")
      .select(
        `
        *,
        exam:exams(id, slug, title, starts_at, ends_at, status, duration_min)
      `,
      )
      .eq("user_id", userId)
      .order("started_at", { ascending: false }),
    listCertificatesForUser(userId),
  ]);

  type RegRow = { exam: DashboardExamLite | DashboardExamLite[] | null };
  const regs = ((registrations.data ?? []) as unknown as RegRow[])
    .map((r) => (Array.isArray(r.exam) ? r.exam[0] : r.exam))
    .filter((e): e is DashboardExamLite => Boolean(e));

  type AttRow = AttemptRow & {
    exam: DashboardExamLite | DashboardExamLite[] | null;
  };
  const attList: DashboardAttempt[] = ((attempts.data ?? []) as unknown as AttRow[])
    .map((row) => {
      const { exam: examField, ...attempt } = row;
      const exam = Array.isArray(examField) ? examField[0] : examField;
      if (!exam) return null;
      return { ...attempt, exam };
    })
    .filter((a): a is DashboardAttempt => a !== null);

  const attemptByExam = new Map(attList.map((a) => [a.exam_id, a]));
  const now = Date.now();

  const upcoming = regs
    .filter((e) => new Date(e.ends_at).getTime() >= now)
    .sort(
      (a, b) =>
        new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
    )
    .slice(0, 3)
    .map((exam) => ({
      exam,
      registered: true,
      attempt: attemptByExam.get(exam.id) ?? null,
    }));

  const completed = attList.filter((a) => a.status !== "in_progress");
  const percentiles = completed
    .map((a) => a.percentile)
    .filter((p): p is number => p != null);
  const bestPercentile =
    percentiles.length > 0 ? Math.max(...percentiles.map(Number)) : null;

  return {
    stats: {
      exams_registered: regs.length,
      attempts_completed: completed.length,
      certificates: certificates.length,
      best_percentile: bestPercentile,
    },
    upcoming,
    recent_attempts: completed.slice(0, 5),
  };
}

export async function getAttemptByIdForUser(
  attemptId: string,
  userId: string,
): Promise<DashboardAttempt | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("exam_attempts")
    .select(
      `
      *,
      exam:exams(id, slug, title, starts_at, ends_at, status, duration_min)
    `,
    )
    .eq("id", attemptId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;

  type Row = AttemptRow & {
    exam: DashboardExamLite | DashboardExamLite[] | null;
  };
  const row = data as unknown as Row;
  const { exam: examField, ...attempt } = row;
  const exam = Array.isArray(examField) ? examField[0] : examField;
  if (!exam) return null;
  return { ...attempt, exam };
}
