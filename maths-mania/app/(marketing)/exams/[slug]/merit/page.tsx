import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { MeritTable } from "@/components/exam/merit-table";
import { getPublicExamBySlug } from "@/lib/exams/public";
import { getMeritListForExam, getMeritMetaForExam } from "@/lib/exams/merit";
import { getAttemptForUser } from "@/lib/exams/attempt";
import { getUser } from "@/lib/auth/session";
import { formatIndianNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const exam = await getPublicExamBySlug(slug);
  if (!exam) return { title: "Merit list" };
  return { title: `${exam.title} — All-India merit list` };
}

export default async function ExamMeritPage({ params }: Props) {
  const { slug } = await params;
  const exam = await getPublicExamBySlug(slug);
  if (!exam) notFound();

  if (exam.status !== "merit_published") {
    return (
      <Section padding="lg" tone="default">
        <Container size="md" className="text-center">
          <Heading as="h1" size="h2">
            Merit list not published yet
          </Heading>
          <p className="mt-4 text-[var(--color-text-muted)]">
            Results for {exam.title} will appear here within 60 minutes of the
            exam closing.
          </p>
          <Button asChild className="mt-6" variant="primary">
            <Link href={`/exams/${slug}`}>Back to exam</Link>
          </Button>
        </Container>
      </Section>
    );
  }

  const [rows, meta, user] = await Promise.all([
    getMeritListForExam(exam.id),
    getMeritMetaForExam(exam.id),
    getUser(),
  ]);

  const myAttempt =
    user ? await getAttemptForUser(exam.id, user.id) : null;

  return (
    <Section padding="lg" tone="default">
      <Container size="lg">
        <p className="text-sm font-semibold uppercase tracking-wider text-[var(--color-primary-600)]">
          All-India merit
        </p>
        <Heading as="h1" size="h1" className="mt-3">
          {exam.title}
        </Heading>
        {meta && (
          <p className="mt-3 text-[var(--color-text-muted)]">
            {formatIndianNumber(meta.total_attempts)} attempts · Top score{" "}
            {Number(meta.top_score ?? 0).toFixed(2)} · Median{" "}
            {Number(meta.median_score ?? 0).toFixed(2)}
          </p>
        )}

        <MeritTable
          className="mt-10"
          rows={rows}
          highlightAttemptId={myAttempt?.id}
        />

        <div className="mt-10 flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <Link href={`/exams/${slug}`}>Exam details</Link>
          </Button>
          {myAttempt && (
            <Button asChild variant="primary">
              <Link href={`/exams/${slug}/result`}>Your scorecard</Link>
            </Button>
          )}
        </div>

        <p className="mt-8 text-sm text-[var(--color-text-faint)]">
          Names shown as first name + last initial. Top 10% receive a
          downloadable certificate.
        </p>
      </Container>
    </Section>
  );
}
