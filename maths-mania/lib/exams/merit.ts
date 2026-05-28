import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { Database } from "@/lib/database.types";

export type MeritRow = Database["public"]["Views"]["public_merit"]["Row"] & {
  exam_id: string;
};

export type MeritListMeta = {
  total_attempts: number;
  top_score: number | null;
  median_score: number | null;
  published_at: string;
};

export async function getMeritListForExam(
  examId: string,
): Promise<MeritRow[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("public_merit")
    .select("*")
    .eq("exam_id", examId)
    .order("all_india_rank", { ascending: true });

  if (error) {
    console.error("[merit] list", error.message);
    return [];
  }
  return (data ?? []) as MeritRow[];
}

export async function getMeritMetaForExam(
  examId: string,
): Promise<MeritListMeta | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("merit_lists")
    .select("total_attempts, top_score, median_score, published_at")
    .eq("exam_id", examId)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return {
    total_attempts: data.total_attempts,
    top_score: data.top_score,
    median_score: data.median_score,
    published_at: data.published_at,
  };
}

export type PublishMeritResult =
  | {
      ok: true;
      total_attempts: number;
      top_score: number;
      median_score: number;
      certificates_issued: number;
    }
  | { ok: false; error: string };

export async function publishExamMerit(
  examId: string,
): Promise<PublishMeritResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase not configured." };
  }
  const supabase = await createClient();
  if (!supabase) return { ok: false, error: "Database unavailable." };

  const { data, error } = await supabase.rpc("publish_exam_merit", {
    p_exam_id: examId,
  });

  if (error) {
    console.error("[merit] publish", error.message);
    return { ok: false, error: error.message };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, error: "No result from publish." };

  return {
    ok: true,
    total_attempts: row.total_attempts,
    top_score: Number(row.top_score),
    median_score: Number(row.median_score),
    certificates_issued: row.certificates_issued,
  };
}
