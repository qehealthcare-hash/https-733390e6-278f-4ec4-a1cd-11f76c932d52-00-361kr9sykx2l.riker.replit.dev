import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Heading } from "@/components/ui/heading";
import { LobbyPanel } from "@/components/exam/lobby-panel";
import {
  getPublicExamBySlug,
  isUserRegistered,
  formatExamScheduleIST,
  requestNowMs,
} from "@/lib/exams/public";
import { getAttemptForUser } from "@/lib/exams/attempt";
import { requireAuth } from "@/lib/auth/session";
import { examWindowPhase } from "@/lib/exams/window";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

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

  if (attempt && attempt.status === "in_progress") {
    redirect(`/exams/${slug}/attempt`);
  }

  const now = requestNowMs();
  const phase = examWindowPhase(now, exam.starts_at, exam.ends_at);

  if (phase === "ended") {
    redirect(`/exams/${slug}/closed`);
  }
  if (phase === "before_lobby") {
    redirect(`/exams/${slug}/not-started`);
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
          <LobbyPanel
            examSlug={slug}
            startsAtIso={exam.starts_at}
            endsAtIso={exam.ends_at}
            serverNowIso={new Date().toISOString()}
          />
        </div>
      </Container>
    </Section>
  );
}
