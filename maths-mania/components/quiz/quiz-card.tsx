import Link from "next/link";
import { ArrowRight, Clock, ListChecks } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import type { QuizSummary } from "@/lib/quizzes";
import { getCategoryLabel } from "@/lib/quizzes";
import { cn } from "@/lib/utils";

type QuizCardProps = {
  quiz: QuizSummary;
  className?: string;
};

export function QuizCard({ quiz, className }: QuizCardProps) {
  return (
    <Card className={cn("h-full transition hover:-translate-y-0.5", className)}>
      <CardBody className="flex h-full flex-col">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-primary-600)]">
          {getCategoryLabel(quiz.category)}
        </span>
        <h2 className="mt-2 font-display text-xl font-bold text-[var(--color-text)]">
          <Link href={`/quiz/${quiz.slug}`} className="hover:text-[var(--color-primary-600)]">
            {quiz.title}
          </Link>
        </h2>
        <p className="mt-2 flex-1 text-sm text-[var(--color-text-muted)]">
          {quiz.description}
        </p>
        <div className="mt-4 flex flex-wrap gap-3 text-xs text-[var(--color-text-faint)]">
          <span className="inline-flex items-center gap-1">
            <ListChecks className="size-3.5" aria-hidden />
            {quiz.questionCount} questions
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" aria-hidden />
            ~{quiz.estimatedMinutes} min
          </span>
        </div>
        <Link
          href={`/quiz/${quiz.slug}`}
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-primary-600)]"
        >
          Start quiz
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </CardBody>
    </Card>
  );
}
