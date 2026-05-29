import Link from "next/link";
import { Trophy, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import type { Quiz, QuizQuestion } from "@/lib/quizzes";
import { cn } from "@/lib/utils";

export type TopicBreakdown = {
  topic: string;
  correct: number;
  total: number;
};

type QuizResultsProps = {
  quiz: Quiz;
  answers: Record<string, string>;
  onRetry: () => void;
};

export function computeTopicBreakdown(
  questions: QuizQuestion[],
  answers: Record<string, string>,
): TopicBreakdown[] {
  const map = new Map<string, { correct: number; total: number }>();

  for (const q of questions) {
    const entry = map.get(q.topic) ?? { correct: 0, total: 0 };
    entry.total += 1;
    if (answers[q.id] === q.correctOptionId) entry.correct += 1;
    map.set(q.topic, entry);
  }

  return [...map.entries()].map(([topic, { correct, total }]) => ({
    topic,
    correct,
    total,
  }));
}

export function QuizResults({ quiz, answers, onRetry }: QuizResultsProps) {
  const total = quiz.questions.length;
  const correct = quiz.questions.filter(
    (q) => answers[q.id] === q.correctOptionId,
  ).length;
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
  const breakdown = computeTopicBreakdown(quiz.questions, answers);

  return (
    <div className="space-y-8">
      <Card className="border-[var(--color-primary-200)] bg-[var(--color-primary-50)]">
        <CardBody className="text-center">
          <Trophy
            className="mx-auto size-10 text-[var(--color-primary-600)]"
            aria-hidden
          />
          <p className="mt-4 font-display text-4xl font-bold text-[var(--color-text)]">
            {correct}/{total}
          </p>
          <p className="mt-1 text-lg text-[var(--color-text-muted)]">
            {pct}% correct — {pct >= 70 ? "strong work!" : "review the explanations and try again."}
          </p>
        </CardBody>
      </Card>

      <div>
        <h2 className="font-display text-xl font-bold text-[var(--color-text)]">
          Topic breakdown
        </h2>
        <ul className="mt-4 space-y-3">
          {breakdown.map((row) => {
            const rowPct = Math.round((row.correct / row.total) * 100);
            return (
              <li key={row.topic}>
                <div className="flex justify-between text-sm">
                  <span className="font-medium text-[var(--color-text)]">
                    {row.topic}
                  </span>
                  <span className="text-[var(--color-text-muted)]">
                    {row.correct}/{row.total} ({rowPct}%)
                  </span>
                </div>
                <div
                  className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--color-surface-alt)]"
                  role="presentation"
                >
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      rowPct >= 70
                        ? "bg-[var(--color-success)]"
                        : rowPct >= 40
                          ? "bg-[var(--color-primary-400)]"
                          : "bg-[var(--color-error)]",
                    )}
                    style={{ width: `${rowPct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-6">
        <h3 className="font-display text-lg font-bold text-[var(--color-text)]">
          Ready for the real thing?
        </h3>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          Self-paced quizzes build skill. Live exams build pressure — same
          questions, synchronized clock, All-India rank.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button variant="primary" size="md" asChild>
            <Link href="/exams">
              Explore live exams
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
          <Button variant="outline" size="md" type="button" onClick={onRetry}>
            Retry this quiz
          </Button>
          <Button variant="ghost" size="md" asChild>
            <Link href="/quiz">All quizzes</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
