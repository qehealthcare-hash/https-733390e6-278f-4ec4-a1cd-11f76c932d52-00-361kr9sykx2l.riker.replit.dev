import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Heading } from "@/components/ui/heading";
import { ExamForm } from "@/components/admin/exam-form";
import { DeleteExamButton } from "@/components/admin/delete-exam-button";
import { QuestionForm } from "@/components/admin/question-form";
import { QuestionsList } from "@/components/admin/questions-list";
import { ExamStatusBadge } from "@/components/admin/exam-status-badge";
import { getExamById, getQuestionsForExam } from "@/lib/exams/admin-data";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const exam = await getExamById(id);
  return { title: exam ? `Admin — ${exam.title}` : "Admin — Exam" };
}

export default async function AdminExamDetailPage({ params }: Props) {
  const { id } = await params;
  const exam = await getExamById(id);
  if (!exam) notFound();

  const questions = await getQuestionsForExam(id);

  return (
    <>
      <Link
        href="/admin/exams"
        className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-primary-600)] hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All exams
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Heading as="h1" size="h2">
          {exam.title}
        </Heading>
        <ExamStatusBadge status={exam.status} />
      </div>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        {questions.length} question{questions.length === 1 ? "" : "s"} · {exam.duration_min}{" "}
        min · {exam.total_marks} marks
      </p>

      <section className="mt-10">
        <h2 className="font-display text-lg font-bold">Exam settings</h2>
        <div className="mt-4">
          <ExamForm exam={exam} />
        </div>
        <DeleteExamButton examId={exam.id} />
      </section>

      <section className="mt-14">
        <h2 className="font-display text-lg font-bold">Question bank</h2>
        <div className="mt-6">
          <QuestionsList examId={id} questions={questions} />
        </div>
        <div className="mt-8">
          <QuestionForm examId={id} />
        </div>
      </section>
    </>
  );
}
