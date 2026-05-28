import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { LobbyPanel } from "@/components/exam/lobby-panel";
import {
  getPublicExamBySlug,
  isUserRegistered,
  formatExamScheduleIST,
  requestNowMs,
} from "@/lib/exams/public";
import { getAttemptForUser } from "@/lib/exams/attempt";
import { requireAuth } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

const LOBBY_OPENS_MIN = 15;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const exam = await getPublicExamBySlug(slug);
  if (!exam) return { title: "Lobby" };
  return { title: `${exam.title} — Lobby` };
}

export default async function ExamLobbyPage({ params }: Props) {
  const { slug } = await params;
  const exam = await getPublicExamBySlug(slug);
  if (!exam) notFound();

  const { user } = await requireAuth({
    requireOnboarded: true,
    loginPath: `/login?next=${encodeURIComponent(`/exams/${slug}/lobby`)}`,
  });

  const registered = await isUserRegistered(exam.id, user.id);
  if (!registered) {
    redirect(`/exams/${slug}`);
  }

  const attempt = await getAttemptForUser(exam.id, user.id);
  if (attempt && attempt.status !== "in_progress") {
    redirect(`/exams/${slug}/result`);
  }

  const now = requestNowMs();
  const startsAt = new Date(exam.starts_at).getTime();
  const endsAt = new Date(exam.ends_at).getTime();
  const lobbyOpensAt = startsAt - LOBBY_OPENS_MIN * 60 * 1000;
  const lobbyOpen = now >= lobbyOpensAt;
  const examEnded = now > endsAt;

  if (attempt && attempt.status === "in_progress") {
    redirect(`/exams/${slug}/attempt`);
  }

  return (
    <Section padding="lg" tone="default">
      <Container size="md">
        <p className="text-sm font-semibold uppercase tracking-wider text-[var(--color-primary-600)]">
          Exam lobby
        </p>
        <Heading as="h1" size="h1" className="mt-3">
          {exam.title}
        </Heading>
        <p className="mt-3 text-[var(--color-text-muted)]">
          {exam.duration_min} minutes · {exam.question_count} questions ·{" "}
          Starts {formatExamScheduleIST(exam.starts_at)} IST
        </p>

        <div className="mt-10">
          {examEnded ? (
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
              <Heading as="h2" size="h3">
                The exam window has closed
              </Heading>
              <p className="mt-2 text-[var(--color-text-muted)]">
                Sorry, you missed this one. Merit list publishes within an hour.
              </p>
              <Button asChild variant="outline" className="mt-6">
                <Link href="/exams">Browse other exams</Link>
              </Button>
            </div>
          ) : !lobbyOpen ? (
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
              <Heading as="h2" size="h3">
                Lobby opens 15 minutes before start
              </Heading>
              <p className="mt-2 text-[var(--color-text-muted)]">
                Come back closer to {formatExamScheduleIST(exam.starts_at)} IST
                to run your system check.
              </p>
              <Button asChild variant="outline" className="mt-6">
                <Link href={`/exams/${slug}`}>Back to exam details</Link>
              </Button>
            </div>
          ) : (
            <LobbyPanel
              examSlug={slug}
              startsAtIso={exam.starts_at}
              endsAtIso={exam.ends_at}
              serverNowIso={new Date().toISOString()}
            />
          )}
        </div>
      </Container>
    </Section>
  );
}
