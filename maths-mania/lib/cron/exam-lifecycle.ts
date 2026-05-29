import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/supabase/config";

export type ExamLifecycleCronResult = {
  ranAt: string;
  statusAdvance: { promoted_live: number; promoted_closed: number } | null;
  merit: Array<{
    examId: string;
    slug: string;
    ok: boolean;
    error?: string;
    total_attempts?: number;
    certificates_issued?: number;
  }>;
};

function meritDelayMinutes(): number {
  const raw = Number(process.env.MERIT_PUBLISH_DELAY_MIN ?? 60);
  return Number.isFinite(raw) && raw > 0 ? raw : 60;
}

/**
 * Vercel Cron entry: advance exam statuses and auto-publish merit lists
 * `MERIT_PUBLISH_DELAY_MIN` after `ends_at`.
 */
export async function runExamLifecycleCron(): Promise<ExamLifecycleCronResult> {
  const ranAt = new Date().toISOString();

  if (!isSupabaseAdminConfigured()) {
    return { ranAt, statusAdvance: null, merit: [] };
  }

  const admin = createAdminClient();

  const { data: advanceRaw, error: advanceError } = await admin.rpc(
    "cron_advance_exam_statuses",
  );

  if (advanceError) {
    console.error("[cron] advance statuses", advanceError.message);
  }

  const statusAdvance =
    advanceRaw && typeof advanceRaw === "object"
      ? {
          promoted_live: Number(
            (advanceRaw as Record<string, unknown>).promoted_live ?? 0,
          ),
          promoted_closed: Number(
            (advanceRaw as Record<string, unknown>).promoted_closed ?? 0,
          ),
        }
      : null;

  const delayMin = meritDelayMinutes();
  const cutoff = new Date(Date.now() - delayMin * 60_000).toISOString();

  const { data: dueExams, error: listError } = await admin
    .from("exams")
    .select("id, slug, title, status, ends_at")
    .in("status", ["closed", "live"])
    .lte("ends_at", cutoff);

  if (listError) {
    console.error("[cron] list exams for merit", listError.message);
    return { ranAt, statusAdvance, merit: [] };
  }

  const merit: ExamLifecycleCronResult["merit"] = [];

  for (const exam of dueExams ?? []) {
    const { data, error } = await admin.rpc("publish_exam_merit", {
      p_exam_id: exam.id,
    });

    if (error) {
      const msg = error.message;
      if (
        msg.includes("EXAM_NOT_ENDED") ||
        msg.includes("EXAM_NOT_READY") ||
        msg.includes("merit_published")
      ) {
        continue;
      }
      merit.push({
        examId: exam.id,
        slug: exam.slug,
        ok: false,
        error: msg,
      });
      continue;
    }

    const row = Array.isArray(data) ? data[0] : data;
    merit.push({
      examId: exam.id,
      slug: exam.slug,
      ok: true,
      total_attempts: row?.total_attempts,
      certificates_issued: row?.certificates_issued,
    });
  }

  return { ranAt, statusAdvance, merit };
}
