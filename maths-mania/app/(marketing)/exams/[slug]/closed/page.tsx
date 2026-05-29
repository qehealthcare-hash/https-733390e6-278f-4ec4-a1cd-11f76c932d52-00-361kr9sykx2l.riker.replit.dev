import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { ExamStatusPanel } from "@/components/exam/exam-status-panel";
import { getPublicExamBySlug } from "@/lib/exams/public";
import { NOINDEX_ROBOTS } from "@/lib/seo";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const exam = await getPublicExamBySlug(slug);
  return {
    title: exam ? `${exam.title} — Closed` : "Exam closed",
    robots: NOINDEX_ROBOTS,
  };
}

export default async function ExamClosedPage({ params }: Props) {
  const { slug } = await params;
  const exam = await getPublicExamBySlug(slug);
  if (!exam) notFound();

  return (
    <Section padding="lg" tone="default">
      <Container size="md">
        <ExamStatusPanel
          variant="closed"
          examTitle={exam.title}
          examSlug={slug}
        />
      </Container>
    </Section>
  );
}
