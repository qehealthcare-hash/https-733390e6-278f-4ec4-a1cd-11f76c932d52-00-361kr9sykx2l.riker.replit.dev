import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { ExamQuestionReview } from "@/components/exam/exam-question-review";
import { requireAuth } from "@/lib/auth/guard";
import { getAttemptByIdForUser } from "@/lib/dashboard";
import {
  getAttemptReview,
  getAttemptScorecard,
} from "@/lib/exams/attempt";
import { getPublicExamBySlug, formatExamScheduleIST } from "@/lib/exams/public";
import { listCertificatesForUser } from "@/lib/exams/certificates";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: `Attempt ${id.slice(0, 8)}…`, robots: { index: false } };
}

export default async function DashboardAttemptDetailPage({ params }: Props) {
  const { id } = await params;
  const { user } = await requireAuth({ requireOnboarded: true });

  const attemptRow = await getAttemptByIdForUser(id, user.id);
  if (!attemptRow) notFound();

  const exam = await getPublicExamBySlug(attemptRow.exam.slug);
  if (!exam) notFound();

  if (attemptRow.status === "in_progress") {
    return (
      <>
        <Heading as="h1" size="h3">
          Attempt in progress
        </Heading>
        <p className="mt-3 text-[var(--color-text-muted)]">
          Resume to finish {exam.title}.
        </p>
        <Button asChild className="mt-6" variant="primary">
          <Link href={`/exams/${attemptRow.exam.slug}/attempt`}>
            Resume →
          </Link>
        </Button>
      </>
    );
  }

  const [review, scorecard, certificates] = await Promise.all([
    getAttemptReview(exam.id, attemptRow.id),
    getAttemptScorecard(attemptRow, exam.question_count),
    listCertificatesForUser(user.id),
  ]);

  const myCert = certificates.find((c) => c.attempt_id === attemptRow.id);
  const finalScore = Number(attemptRow.final_score ?? 0);
  const ranked =
    attemptRow.status === "graded" && attemptRow.all_india_rank != null;

  return (
    <>
      <Link
        href="/dashboard/exams"
        className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-primary-600)] hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        My exams
      </Link>

      <Heading as="h1" size="h2" className="mt-4">
        {exam.title}
      </Heading>
      <p className="mt-2 text-[var(--color-text-muted)]">
        Submitted{" "}
        {attemptRow.submitted_at
          ? formatExamScheduleIST(attemptRow.submitted_at)
          : "—"}
        {attemptRow.auto_submitted && " (auto-submitted)"}
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <p className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">
            Score
          </p>
          <p className="mt-2 font-display text-3xl font-bold tabular-nums">
            {finalScore.toFixed(2)}
          </p>
        </div>
        {ranked && (
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <p className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">
              All-India rank
            </p>
            <p className="mt-2 font-display text-3xl font-bold text-[var(--color-primary-600)]">
              #{attemptRow.all_india_rank}
            </p>
          </div>
        )}
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <p className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">
            Correct
          </p>
          <p
            className={cn(
              "mt-2 font-display text-3xl font-bold text-[var(--color-success)]",
            )}
          >
            {scorecard?.correct_count ?? 0}
          </p>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <p className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">
            Incorrect
          </p>
          <p
            className={cn(
              "mt-2 font-display text-3xl font-bold text-[var(--color-error)]",
            )}
          >
            {scorecard?.incorrect_count ?? 0}
          </p>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link href={`/exams/${attemptRow.exam.slug}/result`}>
            Full scorecard
          </Link>
        </Button>
        {exam.status === "merit_published" && (
          <Button asChild variant="outline">
            <Link href={`/exams/${attemptRow.exam.slug}/merit`}>Merit list</Link>
          </Button>
        )}
        {myCert && (
          <Button asChild variant="primary">
            <Link href={`/dashboard/certificates/${myCert.id}`}>
              Certificate
            </Link>
          </Button>
        )}
      </div>

      {review.questions.length > 0 && (
        <>
          <Heading as="h2" size="h3" className="mt-12">
            Question review
          </Heading>
          <ExamQuestionReview
            questions={review.questions}
            answers={review.answers}
          />
        </>
      )}
    </>
  );
}
