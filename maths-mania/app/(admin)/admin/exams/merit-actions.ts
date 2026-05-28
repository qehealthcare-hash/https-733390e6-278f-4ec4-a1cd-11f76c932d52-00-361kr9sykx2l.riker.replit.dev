"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guard";
import { publishExamMerit } from "@/lib/exams/merit";
import { getExamById } from "@/lib/exams/admin-data";

export type PublishMeritState = {
  error?: string;
  ok?: boolean;
  message?: string;
};

export async function publishMeritAction(
  examId: string,
  _prev: PublishMeritState,
): Promise<PublishMeritState> {
  void _prev;
  await requireAdmin();

  const exam = await getExamById(examId);
  if (!exam) return { error: "Exam not found." };

  const result = await publishExamMerit(examId);
  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePath("/admin/exams");
  revalidatePath(`/admin/exams/${examId}`);
  revalidatePath("/exams");
  revalidatePath(`/exams/${exam.slug}`);
  revalidatePath(`/exams/${exam.slug}/merit`);
  revalidatePath(`/exams/${exam.slug}/result`);

  return {
    ok: true,
    message: `Merit published — ${result.total_attempts} attempts ranked, ${result.certificates_issued} certificates issued.`,
  };
}
