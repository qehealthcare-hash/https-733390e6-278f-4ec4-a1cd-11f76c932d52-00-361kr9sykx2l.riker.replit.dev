import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { CountdownTimer } from "@/components/exam/countdown-timer";
import { RegistrationCounter } from "@/components/exam/registration-counter";
import { RegisterButton } from "@/components/exam/register-button";
import {
  getPublicExamBySlug,
  getPublicExamSlugs,
  isRegistrationOpen,
  isUserRegistered,
  formatExamScheduleIST,
  requestNowMs,
} from "@/lib/exams/public";
import { formatPillar, formatDifficulty } from "@/lib/exams/format";
import { getUser } from "@/lib/auth/session";
import { Breadcrumbs } from "@/components/seo/breadcrumbs";
import { JsonLd } from "@/components/seo/json-ld";
import { createPageMetadata, examEventSchema } from "@/lib/seo";

type Props = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
  const slugs = await getPublicExamSlugs();
  return slugs.map((slug) => ({ slug }));
}

export const dynamicParams = true;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const exam = await getPublicExamBySlug(slug);
  if (!exam) return { title: "Exam" };
  const description =
    exam.description ??
    `Free live All-India mock — ${exam.duration_min} minutes, ${exam.question_count} questions.`;
  return createPageMetadata({
    title: exam.title,
    description,
    path: `/exams/${slug}`,
  });
}

export default async function ExamLandingPage({ params }: Props) {
  const { slug } = await params;
  const exam = await getPublicExamBySlug(slug);
  if (!exam) notFound();

  const user = await getUser();
  const registered = user ? await isUserRegistered(exam.id, user.id) : false;
  const registrationOpen = isRegistrationOpen(exam);
  const wrongMark = Math.abs(Number(exam.marking_wrong));

  return (
    <>
      <JsonLd
        data={examEventSchema({
          name: exam.title,
          description:
            exam.description ??
            `Free synchronized All-India mock exam — ${exam.duration_min} minutes.`,
          path: `/exams/${exam.slug}`,
          startsAt: exam.starts_at,
          endsAt: exam.ends_at,
        })}
      />
      <Section padding="lg" tone="notebook">
        <Container size="md">
          <Breadcrumbs
            className="mb-6"
            items={[
              { name: "Home", href: "/" },
              { name: "Live exams", href: "/exams" },
              { name: exam.title },
            ]}
          />
          <p className="text-sm font-semibold uppercase tracking-wider text-[var(--color-primary-600)]">
            {formatPillar(exam.pillar)} · {formatDifficulty(exam.difficulty)} ·{" "}
            {exam.is_free ? "Free" : `₹${exam.price_inr}`}
          </p>
          <Heading as="h1" size="h1" className="mt-4">
            {exam.title}
          </Heading>
          {exam.description && (
            <p className="mt-4 text-lg text-[var(--color-text-muted)]">
              {exam.description}
            </p>
          )}
          <p className="mt-4 text-lg text-[var(--color-text-muted)]">
            {exam.duration_min} minutes · {exam.question_count} questions ·
            +{exam.marking_correct} / −{wrongMark} marking · Merit within 60
            minutes of close.
          </p>
          <p className="mt-2 text-sm text-[var(--color-text-faint)]">
            Starts {formatExamScheduleIST(exam.starts_at)} IST
          </p>

          {(exam.status === "scheduled" || exam.status === "live") && (
            <div className="mt-8 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center shadow-[var(--shadow-card)]">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                {exam.status === "live" ? "Exam is live" : "Exam starts in"}
              </p>
              {exam.status === "scheduled" && (
                <div className="mt-3 flex justify-center">
                  <CountdownTimer targetIso={exam.starts_at} size="lg" />
                </div>
              )}
              <div className="mt-4">
                <RegistrationCounter
                  key={exam.registration_count}
                  examId={exam.id}
                  initialCount={exam.registration_count}
                />
              </div>
            </div>
          )}

          <div className="mt-8 flex flex-wrap items-start gap-3">
            {(() => {
              const nowMs = requestNowMs();
              const startMs = new Date(exam.starts_at).getTime();
              const endMs = new Date(exam.ends_at).getTime();
              const isLive = nowMs >= startMs && nowMs <= endMs;
              const lobbyOpen =
                registered && nowMs >= startMs - 15 * 60_000 && nowMs <= endMs;

              if (registered && (lobbyOpen || isLive)) {
                return (
                  <Button asChild size="lg" variant="primary">
                    <Link href={`/exams/${exam.slug}/lobby`}>
                      Enter lobby →
                    </Link>
                  </Button>
                );
              }
              if (registered && exam.status === "merit_published") {
                return (
                  <Button asChild size="lg" variant="primary">
                    <Link href={`/exams/${exam.slug}/result`}>
                      View scorecard →
                    </Link>
                  </Button>
                );
              }
              return (
                <RegisterButton
                  examSlug={exam.slug}
                  alreadyRegistered={registered}
                  registrationOpen={registrationOpen}
                />
              );
            })()}
            <Button asChild size="lg" variant="outline">
              <Link href="/exams">All exams</Link>
            </Button>
            {exam.status === "merit_published" && (
              <Button asChild size="lg" variant="outline">
                <Link href={`/exams/${exam.slug}/merit`}>Merit list</Link>
              </Button>
            )}
          </div>

          {exam.rules_md && (
            <div className="prose prose-sm mt-10 max-w-none text-[var(--color-text-muted)]">
              <h2 className="font-display text-lg font-bold text-[var(--color-text)]">
                Rules
              </h2>
              <div className="whitespace-pre-wrap">{exam.rules_md}</div>
            </div>
          )}

          <p className="mt-8 text-sm text-[var(--color-text-faint)]">
            Lobby opens 15 minutes before start time. Your scorecard includes
            question review; the All-India merit list publishes after the exam
            closes.
          </p>
        </Container>
      </Section>
    </>
  );
}
