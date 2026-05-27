import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { getPublicExamBySlug } from "@/lib/exams/public";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const exam = await getPublicExamBySlug(slug);
  if (!exam) return { title: "Merit list" };
  return { title: `${exam.title} — Merit list` };
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

  return (
    <Section padding="lg" tone="default">
      <Container size="md" className="text-center">
        <Heading as="h1" size="h2">
          Merit list — {exam.title}
        </Heading>
        <p className="mt-4 text-[var(--color-text-muted)]">
          Full All-India merit table ships in milestone 14.
        </p>
        <Button asChild className="mt-6" variant="outline">
          <Link href={`/exams/${slug}`}>Exam details</Link>
        </Button>
      </Container>
    </Section>
  );
}
