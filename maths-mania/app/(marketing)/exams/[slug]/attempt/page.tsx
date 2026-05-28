import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { AttemptPlayer } from "@/components/exam/attempt-player";
import { getPublicExamBySlug, isUserRegistered } from "@/lib/exams/public";
import {
  getAttemptAnswers,
  getAttemptQuestions,
  startAttempt,
  type StartAttemptReason,
} from "@/lib/exams/attempt";
import { requireAuth } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const exam = await getPublicExamBySlug(slug);
  return { title: exam ? `${exam.title} — Attempt` : "Attempt", robots: { index: false } };
}

const REASON_COPY: Record<StartAttemptReason, string> = {
  AUTH_REQUIRED: "Please sign in to start your attempt.",
  EXAM_NOT_FOUND: "We could not find this exam.",
  EXAM_NOT_STARTED: "The exam has not started yet. Wait in the lobby.",
  EXAM_ENDED: "The exam window has closed.",
  NOT_REGISTERED: "Register for this exam first.",
  ATTEMPT_FINISHED: "You have already submitted this attempt.",
  SUPABASE_NOT_CONFIGURED: "Exams are not available right now.",
  UNKNOWN: "We could not start the attempt. Please try again.",
};

export default async function ExamAttemptPage({ params }: Props) {
  const { slug } = await params;
  const exam = await getPublicExamBySlug(slug);
  if (!exam) notFound();

  const { user } = await requireAuth({
    requireOnboarded: true,
    loginPath: `/login?next=${encodeURIComponent(`/exams/${slug}/attempt`)}`,
  });

  const registered = await isUserRegistered(exam.id, user.id);
  if (!registered) redirect(`/exams/${slug}`);

  const result = await startAttempt(exam.id);

  if (!result.ok) {
    if (result.reason === "ATTEMPT_FINISHED") {
      redirect(`/exams/${slug}/result`);
    }
    if (result.reason === "EXAM_NOT_STARTED") {
      redirect(`/exams/${slug}/lobby`);
    }
    return (
      <Section padding="lg" tone="default">
        <Container size="sm" className="text-center">
          <Heading as="h1" size="h3">
            Could not start exam
          </Heading>
          <p className="mt-3 text-[var(--color-text-muted)]">
            {REASON_COPY[result.reason]}
          </p>
          <Button asChild className="mt-6" variant="outline">
            <Link href={`/exams/${slug}`}>Back to exam</Link>
          </Button>
        </Container>
      </Section>
    );
  }

  const [questions, answers] = await Promise.all([
    getAttemptQuestions(exam.id),
    getAttemptAnswers(result.data.attempt_id),
  ]);

  if (questions.length === 0) {
    return (
      <Section padding="lg" tone="default">
        <Container size="sm" className="text-center">
          <Heading as="h1" size="h3">
            No questions published yet
          </Heading>
          <p className="mt-3 text-[var(--color-text-muted)]">
            The admin team is still preparing this exam. Hold on for a moment
            and refresh.
          </p>
          <Button asChild className="mt-6" variant="outline">
            <Link href={`/exams/${slug}/lobby`}>Back to lobby</Link>
          </Button>
        </Container>
      </Section>
    );
  }

  return (
    <AttemptPlayer
      examSlug={slug}
      examTitle={exam.title}
      attemptId={result.data.attempt_id}
      questions={questions}
      initialAnswers={answers}
      endsAtIso={result.data.exam_ends_at}
      serverNowIso={result.data.server_now}
    />
  );
}
