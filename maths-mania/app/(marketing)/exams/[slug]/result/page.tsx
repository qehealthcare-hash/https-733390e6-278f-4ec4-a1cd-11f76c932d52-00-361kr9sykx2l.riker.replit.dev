import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { ExamQuestionReview } from "@/components/exam/exam-question-review";
import {
  getPublicExamBySlug,
  formatExamScheduleIST,
} from "@/lib/exams/public";
import {
  getAttemptForUser,
  getAttemptReview,
  getAttemptScorecard,
} from "@/lib/exams/attempt";
import { listCertificatesForUser } from "@/lib/exams/certificates";
import { requireAuth } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const exam = await getPublicExamBySlug(slug);
  return {
    title: exam ? `${exam.title} — Your scorecard` : "Scorecard",
    robots: { index: false },
  };
}

type StatProps = {
  label: string;
  value: string | number;
  tone?: "default" | "success" | "error" | "muted";
};

function Stat({ label, value, tone = "default" }: StatProps) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
        {label}
      </p>
      <p
        className={cn(
          "mt-2 font-display text-3xl font-bold tabular-nums",
          tone === "success" && "text-[var(--color-success)]",
          tone === "error" && "text-[var(--color-error)]",
          tone === "muted" && "text-[var(--color-text-muted)]",
        )}
      >
        {value}
      </p>
    </div>
  );
}

export default async function ExamResultPage({ params }: Props) {
  const { slug } = await params;
  const exam = await getPublicExamBySlug(slug);
  if (!exam) notFound();

  const { user } = await requireAuth({
    requireOnboarded: true,
    loginPath: `/login?next=${encodeURIComponent(`/exams/${slug}/result`)}`,
  });

  const attempt = await getAttemptForUser(exam.id, user.id);
  if (!attempt) {
    return (
      <Section padding="lg" tone="default">
        <Container size="md" className="text-center">
          <Heading as="h1" size="h3">
            No attempt found
          </Heading>
          <p className="mt-3 text-[var(--color-text-muted)]">
            You have not attempted this exam.
          </p>
          <Button asChild className="mt-6" variant="primary">
            <Link href={`/exams/${slug}`}>Back to exam</Link>
          </Button>
        </Container>
      </Section>
    );
  }

  if (attempt.status === "in_progress") {
    return (
      <Section padding="lg" tone="default">
        <Container size="md" className="text-center">
          <Heading as="h1" size="h3">
            Attempt still in progress
          </Heading>
          <p className="mt-3 text-[var(--color-text-muted)]">
            Resume your attempt to complete or submit it.
          </p>
          <Button asChild className="mt-6" variant="primary">
            <Link href={`/exams/${slug}/attempt`}>Resume attempt →</Link>
          </Button>
        </Container>
      </Section>
    );
  }

  const [scorecard, review, certificates] = await Promise.all([
    getAttemptScorecard(attempt, exam.question_count),
    getAttemptReview(exam.id, attempt.id),
    listCertificatesForUser(user.id),
  ]);

  const myCert = certificates.find((c) => c.exam_id === exam.id);
  const total = exam.total_marks || 1;
  const finalScore = Number(attempt.final_score ?? 0);
  const percent = Math.max(0, Math.min(100, (finalScore / total) * 100));
  const ranked = attempt.status === "graded" && attempt.all_india_rank != null;

  return (
    <Section padding="lg" tone="default">
      <Container size="md">
        <p className="text-sm font-semibold uppercase tracking-wider text-[var(--color-primary-600)]">
          Scorecard
        </p>
        <Heading as="h1" size="h1" className="mt-3">
          {exam.title}
        </Heading>
        <p className="mt-2 text-[var(--color-text-muted)]">
          Submitted{" "}
          {attempt.submitted_at
            ? formatExamScheduleIST(attempt.submitted_at)
            : "—"}
          {attempt.auto_submitted && " (auto-submitted at time-up)"}
        </p>

        <div className="mt-8 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center shadow-[var(--shadow-card)]">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Final score
          </p>
          <p className="mt-2 font-display text-5xl font-bold tabular-nums text-[var(--color-text)]">
            {finalScore.toFixed(2)}
            <span className="text-2xl text-[var(--color-text-muted)]">
              {" "}
              / {total}
            </span>
          </p>
          {ranked ? (
            <p className="mt-3 text-lg text-[var(--color-text)]">
              All-India rank{" "}
              <span className="font-bold text-[var(--color-primary-600)]">
                #{attempt.all_india_rank}
              </span>
              {attempt.percentile != null && (
                <span className="text-[var(--color-text-muted)]">
                  {" "}
                  · {Number(attempt.percentile).toFixed(1)} percentile
                </span>
              )}
            </p>
          ) : (
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">
              {percent.toFixed(1)}% — Rank publishes when the merit list goes
              live.
            </p>
          )}
        </div>

        {ranked && (attempt.state_rank != null || attempt.city_rank != null) && (
          <div className="mt-4 flex flex-wrap justify-center gap-4 text-sm text-[var(--color-text-muted)]">
            {attempt.state_rank != null && (
              <span>
                State rank <strong>#{attempt.state_rank}</strong>
              </span>
            )}
            {attempt.city_rank != null && (
              <span>
                City rank <strong>#{attempt.city_rank}</strong>
              </span>
            )}
          </div>
        )}

        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat
            label="Correct"
            value={scorecard?.correct_count ?? 0}
            tone="success"
          />
          <Stat
            label="Incorrect"
            value={scorecard?.incorrect_count ?? 0}
            tone="error"
          />
          <Stat
            label="Unattempted"
            value={scorecard?.unattempted_count ?? 0}
            tone="muted"
          />
          <Stat label="Total Q" value={scorecard?.total_questions ?? 0} />
        </div>

        {myCert && (
          <div className="mt-8 rounded-[var(--radius-lg)] border border-[var(--color-primary-500)]/40 bg-[var(--color-primary-50)]/50 p-5">
            <p className="font-semibold text-[var(--color-text)]">
              Top 10% — certificate issued
            </p>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Verification code{" "}
              <span className="font-mono">{myCert.verification_code}</span>
            </p>
            <Button asChild className="mt-4" variant="primary" size="sm">
              <Link href={`/dashboard/certificates/${myCert.id}`}>
                View & print certificate
              </Link>
            </Button>
          </div>
        )}

        <div className="mt-10 flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <Link href="/dashboard/exams">My exams</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/exams/${slug}`}>Exam details</Link>
          </Button>
          {exam.status === "merit_published" && (
            <Button asChild variant="primary">
              <Link href={`/exams/${slug}/merit`}>View merit list</Link>
            </Button>
          )}
        </div>

        {review.questions.length > 0 && (
          <>
            <Heading as="h2" size="h3" className="mt-14">
              Question review
            </Heading>
            <ExamQuestionReview
              questions={review.questions}
              answers={review.answers}
            />
          </>
        )}
      </Container>
    </Section>
  );
}
