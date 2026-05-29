import { CheckCircle2, Circle, XCircle } from "lucide-react";
import { LatexBlock } from "@/components/math/latex-block";
import type { ReviewAnswer, ReviewQuestion } from "@/lib/exams/attempt";
import { cn } from "@/lib/utils";

const LABELS = ["A", "B", "C", "D"];

type ExamQuestionReviewProps = {
  questions: ReviewQuestion[];
  answers: ReviewAnswer[];
};

export function ExamQuestionReview({
  questions,
  answers,
}: ExamQuestionReviewProps) {
  const answerMap = new Map(answers.map((a) => [a.question_id, a]));

  return (
    <ul className="mt-10 space-y-6">
      {questions.map((q) => {
        const ans = answerMap.get(q.id);
        const selected = ans?.selected_idx ?? null;
        const correct = q.correct_idx;
        const status =
          selected === null
            ? "skipped"
            : selected === correct
              ? "correct"
              : "wrong";

        return (
          <li
            key={q.id}
            className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                Q{q.position}
                {q.topic && ` · ${q.topic}`}
              </p>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                  status === "correct" &&
                    "bg-green-50 text-[var(--color-success)] dark:bg-green-950/30",
                  status === "wrong" &&
                    "bg-red-50 text-[var(--color-error)] dark:bg-red-950/30",
                  status === "skipped" &&
                    "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]",
                )}
              >
                {status === "correct" && (
                  <CheckCircle2 className="size-3.5" aria-hidden />
                )}
                {status === "wrong" && (
                  <XCircle className="size-3.5" aria-hidden />
                )}
                {status === "skipped" && (
                  <Circle className="size-3.5" aria-hidden />
                )}
                {status === "correct"
                  ? "Correct"
                  : status === "wrong"
                    ? "Incorrect"
                    : "Skipped"}
                {ans?.marks_awarded != null && (
                  <span className="ml-1 font-mono tabular-nums">
                    ({Number(ans.marks_awarded) >= 0 ? "+" : ""}
                    {Number(ans.marks_awarded)})
                  </span>
                )}
              </span>
            </div>

            <div className="mt-3 rounded-[var(--radius-md)] bg-[var(--color-surface-alt)] px-4 py-3">
              <LatexBlock math={q.question_latex} display />
            </div>

            <ul className="mt-4 space-y-2">
              {q.options.map((opt, idx) => {
                const isCorrect = idx === correct;
                const isSelected = idx === selected;
                return (
                  <li
                    key={idx}
                    className={cn(
                      "flex items-center gap-3 rounded-[var(--radius-md)] border px-3 py-2 text-sm",
                      isCorrect &&
                        "border-[var(--color-success)]/50 bg-green-50/60 dark:bg-green-950/20",
                      isSelected &&
                        !isCorrect &&
                        "border-[var(--color-error)]/50 bg-red-50/60 dark:bg-red-950/20",
                      !isCorrect &&
                        !isSelected &&
                        "border-[var(--color-border)]",
                    )}
                  >
                    <span className="font-mono text-xs font-bold text-[var(--color-text-muted)]">
                      {LABELS[idx]}
                    </span>
                    <LatexBlock math={opt} className="flex-1" />
                  </li>
                );
              })}
            </ul>

            {q.explanation_latex && status !== "correct" && (
              <div className="mt-4 border-t border-[var(--color-border)] pt-4">
                <p className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">
                  Explanation
                </p>
                <div className="mt-2">
                  <LatexBlock math={q.explanation_latex} display />
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
