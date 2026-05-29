import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { ExamStatusPanel } from "@/components/exam/exam-status-panel";
import { getPublicExamBySlug, requestNowMs } from "@/lib/exams/public";
import { examWindowMs, examWindowPhase } from "@/lib/exams/window";
import { NOINDEX_ROBOTS } from "@/lib/seo";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const exam = await getPublicExamBySlug(slug);
  return {
    title: exam ? `${exam.title} — Not started` : "Exam not started",
    robots: NOINDEX_ROBOTS,
  };
}

export default async function ExamNotStartedPage({ params }: Props) {
  const { slug } = await params;
  const exam = await getPublicExamBySlug(slug);
  if (!exam) notFound();

  const now = requestNowMs();
  const phase = examWindowPhase(now, exam.starts_at, exam.ends_at);
  const { lobbyOpensAt } = examWindowMs(exam.starts_at, exam.ends_at);

  const variant =
    phase === "before_lobby" ? "lobby_early" : ("not_started" as const);

  return (
    <Section padding="lg" tone="default">
      <Container size="md">
        <ExamStatusPanel
          variant={variant}
          examTitle={exam.title}
          examSlug={slug}
          startsAtIso={exam.starts_at}
          lobbyOpensAtIso={new Date(lobbyOpensAt).toISOString()}
        />
      </Container>
    </Section>
  );
}
