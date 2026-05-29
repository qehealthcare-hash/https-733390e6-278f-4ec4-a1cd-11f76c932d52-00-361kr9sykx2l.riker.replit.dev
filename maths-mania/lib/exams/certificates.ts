import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export type CertificateRow = {
  id: string;
  attempt_id: string;
  exam_id: string;
  verification_code: string;
  issued_at: string;
  pdf_url: string | null;
};

export type VerifyCertificateResult = {
  valid: boolean;
  exam_title: string | null;
  display_name: string | null;
  final_score: number | null;
  all_india_rank: number | null;
  percentile: number | null;
  issued_at: string | null;
};

export async function verifyCertificateCode(
  code: string,
): Promise<VerifyCertificateResult> {
  const empty: VerifyCertificateResult = {
    valid: false,
    exam_title: null,
    display_name: null,
    final_score: null,
    all_india_rank: null,
    percentile: null,
    issued_at: null,
  };

  if (!isSupabaseConfigured()) return empty;
  const supabase = await createClient();
  if (!supabase) return empty;

  const { data, error } = await supabase.rpc("verify_certificate", {
    p_code: code.trim(),
  });

  if (error) {
    console.error("[certificates] verify", error.message);
    return empty;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.valid) return empty;

  return {
    valid: true,
    exam_title: row.exam_title,
    display_name: row.display_name,
    final_score: row.final_score != null ? Number(row.final_score) : null,
    all_india_rank: row.all_india_rank,
    percentile: row.percentile != null ? Number(row.percentile) : null,
    issued_at: row.issued_at,
  };
}

export type UserCertificate = CertificateRow & {
  exam_title: string;
  exam_slug: string;
  all_india_rank: number | null;
  final_score: number | null;
};

export async function listCertificatesForUser(
  userId: string,
): Promise<UserCertificate[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("certificates")
    .select(
      `
      id,
      attempt_id,
      exam_id,
      verification_code,
      issued_at,
      pdf_url,
      exam:exams(title, slug),
      attempt:exam_attempts(all_india_rank, final_score)
    `,
    )
    .eq("user_id", userId)
    .order("issued_at", { ascending: false });

  if (error) {
    console.error("[certificates] list", error.message);
    return [];
  }

  type Row = {
    id: string;
    attempt_id: string;
    exam_id: string;
    verification_code: string;
    issued_at: string;
    pdf_url: string | null;
    exam: { title: string; slug: string } | { title: string; slug: string }[] | null;
    attempt:
      | { all_india_rank: number | null; final_score: number | null }
      | { all_india_rank: number | null; final_score: number | null }[]
      | null;
  };

  return ((data ?? []) as unknown as Row[]).map((row) => {
    const exam = Array.isArray(row.exam) ? row.exam[0] : row.exam;
    const attempt = Array.isArray(row.attempt) ? row.attempt[0] : row.attempt;
    return {
      id: row.id,
      attempt_id: row.attempt_id,
      exam_id: row.exam_id,
      verification_code: row.verification_code,
      issued_at: row.issued_at,
      pdf_url: row.pdf_url,
      exam_title: exam?.title ?? "Exam",
      exam_slug: exam?.slug ?? "",
      all_india_rank: attempt?.all_india_rank ?? null,
      final_score:
        attempt?.final_score != null ? Number(attempt.final_score) : null,
    };
  });
}

export async function getCertificateForUser(
  certificateId: string,
  userId: string,
): Promise<UserCertificate | null> {
  const all = await listCertificatesForUser(userId);
  return all.find((c) => c.id === certificateId) ?? null;
}
