import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { QuizPlayer } from "@/components/quiz/quiz-player";
import {
  getAllQuizSlugs,
  getCategoryLabel,
  getQuiz,
} from "@/lib/quizzes";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return getAllQuizSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const quiz = getQuiz(slug);
  if (!quiz) return { title: "Quiz" };
  return {
    title: `${quiz.title} — Practice Quiz`,
    description: quiz.description,
  };
}

export default async function QuizPlayPage({ params }: Props) {
  const { slug } = await params;
  const quiz = getQuiz(slug);
  if (!quiz) notFound();

  return (
    <>
      <Section
        padding="md"
        tone="default"
        className="border-b border-[var(--color-border)]"
      >
        <Container size="md">
          <Link
            href="/quiz"
            className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-primary-600)] hover:underline"
          >
            <ArrowLeft className="size-4" aria-hidden />
            All quizzes
          </Link>
          <Eyebrow tone="muted" className="mt-6">
            {getCategoryLabel(quiz.category)}
          </Eyebrow>
          <Heading as="h1" size="h2" className="mt-2">
            {quiz.title}
          </Heading>
          <p className="mt-3 max-w-xl text-[var(--color-text-muted)]">
            {quiz.description}
          </p>
        </Container>
      </Section>

      <Section padding="md" tone="default">
        <Container size="md">
          <QuizPlayer quiz={quiz} />
        </Container>
      </Section>
    </>
  );
}
