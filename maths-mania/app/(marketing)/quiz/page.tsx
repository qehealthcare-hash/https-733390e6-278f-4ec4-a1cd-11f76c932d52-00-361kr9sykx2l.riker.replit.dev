import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { QuizCard } from "@/components/quiz/quiz-card";
import { getAllQuizzes, getQuizzesByCategory, getCategoryLabel } from "@/lib/quizzes";
import type { QuizCategory } from "@/lib/quizzes";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Practice Quiz — Self-paced, un-timed, free",
  description:
    "Diagnostic quizzes by class/exam/topic. No timer, no auth, no ranking — just practice and instant feedback.",
};

const CATEGORIES: (QuizCategory | undefined)[] = [
  undefined,
  "school",
  "banking",
  "ssc",
];

type Props = {
  searchParams: Promise<{ category?: string }>;
};

function parseCategory(value: string | undefined): QuizCategory | undefined {
  if (!value) return undefined;
  const allowed: QuizCategory[] = ["school", "banking", "ssc", "tricks", "general"];
  return allowed.find((c) => c === value.toLowerCase());
}

export default async function QuizHubPage({ searchParams }: Props) {
  const { category: raw } = await searchParams;
  const category = parseCategory(raw);
  const quizzes = getQuizzesByCategory(category);

  return (
    <>
      <Section padding="lg" tone="default" className="border-b border-[var(--color-border)]">
        <Container>
          <Eyebrow tone="accent">Practice mode</Eyebrow>
          <Heading as="h1" size="h1" className="mt-3 max-w-3xl">
            Self-paced quizzes — no login, no timer
          </Heading>
          <p className="mt-4 max-w-2xl text-lg text-[var(--color-text-muted)]">
            The laid-back cousin of our live exams. Instant explanations, KaTeX
            formulas, and a topic breakdown when you finish. Anonymous — we do
            not store your score.
          </p>
        </Container>
      </Section>

      <Section padding="md" tone="default">
        <Container>
          <nav
            aria-label="Filter quizzes by category"
            className="flex flex-wrap gap-2"
          >
            {CATEGORIES.map((cat) => {
              const href = cat ? `/quiz?category=${cat}` : "/quiz";
              const active = category === cat;
              const label = cat ? getCategoryLabel(cat) : "All quizzes";
              return (
                <Link
                  key={label}
                  href={href}
                  className={cn(
                    "rounded-full border px-4 py-2 text-sm font-semibold transition",
                    active
                      ? "border-[var(--color-primary-500)] bg-[var(--color-primary-500)] text-white"
                      : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:border-[var(--color-primary-300)]",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  {label}
                </Link>
              );
            })}
          </nav>

          <ul className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {quizzes.map((quiz) => (
              <li key={quiz.slug}>
                <QuizCard quiz={quiz} />
              </li>
            ))}
          </ul>

          {quizzes.length === 0 && (
            <p className="mt-10 text-[var(--color-text-muted)]">
              No quizzes in this category.{" "}
              <Link href="/quiz" className="font-semibold text-[var(--color-primary-600)]">
                View all
              </Link>
            </p>
          )}

          {getAllQuizzes().length > 0 && (
            <p className="mt-12 text-center text-sm text-[var(--color-text-faint)]">
              Want rank and certificates?{" "}
              <Link
                href="/exams"
                className="font-semibold text-[var(--color-primary-600)] hover:underline"
              >
                Join a live All-India mock →
              </Link>
            </p>
          )}
        </Container>
      </Section>
    </>
  );
}
