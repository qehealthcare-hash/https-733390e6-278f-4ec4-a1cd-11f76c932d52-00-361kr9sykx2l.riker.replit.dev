import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { CountdownTimer } from "@/components/exam/countdown-timer";
import { NEXT_LIVE_EXAM } from "@/lib/home-data";
import { formatIndianNumber } from "@/lib/utils";
import { notFound } from "next/navigation";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (slug !== NEXT_LIVE_EXAM.slug) {
    return { title: "Exam" };
  }
  return {
    title: NEXT_LIVE_EXAM.title,
    description: `Free live All-India mock — ${NEXT_LIVE_EXAM.durationMin} minutes, ${NEXT_LIVE_EXAM.questionCount} questions. Sunday 11 AM IST.`,
  };
}

export default async function ExamLandingPage({ params }: Props) {
  const { slug } = await params;

  if (slug !== NEXT_LIVE_EXAM.slug) {
    notFound();
  }

  return (
    <>
      <Section padding="lg" tone="notebook">
        <Container size="md">
          <p className="text-sm font-semibold uppercase tracking-wider text-[var(--color-primary-600)]">
            Free · All-India · Live
          </p>
          <Heading as="h1" size="h1" className="mt-4">
            {NEXT_LIVE_EXAM.title}
          </Heading>
          <p className="mt-4 text-lg text-[var(--color-text-muted)]">
            {NEXT_LIVE_EXAM.durationMin} minutes · {NEXT_LIVE_EXAM.questionCount}{" "}
            questions · Negative marking 0.25 · Merit list within 60 minutes.
          </p>

          <div className="mt-8 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center shadow-[var(--shadow-card)]">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Exam starts in
            </p>
            <div className="mt-3 flex justify-center">
              <CountdownTimer targetIso={NEXT_LIVE_EXAM.startsAt} size="lg" />
            </div>
            <p className="mt-4 font-mono text-sm text-[var(--color-text-muted)]">
              {formatIndianNumber(NEXT_LIVE_EXAM.registeredCount)} already registered
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" variant="primary">
              <Link href="/login">Register free →</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/exams">All exams</Link>
            </Button>
          </div>

          <p className="mt-8 text-sm text-[var(--color-text-faint)]">
            Full lobby, attempt UI, and anti-cheat ship in milestones 12–13. This
            landing page is live so hero CTAs resolve correctly.
          </p>
        </Container>
      </Section>
    </>
  );
}
