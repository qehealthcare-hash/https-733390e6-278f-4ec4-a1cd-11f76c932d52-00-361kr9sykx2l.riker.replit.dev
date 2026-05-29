"use client";

import * as React from "react";
import { CheckCircle2, XCircle, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LatexBlock } from "@/components/math/latex-block";
import { QuizResults } from "@/components/quiz/quiz-results";
import type { Quiz, QuizQuestion } from "@/lib/quizzes";
import { cn } from "@/lib/utils";

type Phase = "intro" | "question" | "results";

type QuizPlayerProps = {
  quiz: Quiz;
};

export function QuizPlayer({ quiz }: QuizPlayerProps) {
  const [phase, setPhase] = React.useState<Phase>("intro");
  const [index, setIndex] = React.useState(0);
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [selected, setSelected] = React.useState<string | null>(null);
  const [revealed, setRevealed] = React.useState(false);

  const question = quiz.questions[index];
  const total = quiz.questions.length;

  function resetAttempt() {
    setPhase("intro");
    setIndex(0);
    setAnswers({});
    setSelected(null);
    setRevealed(false);
  }

  function startQuiz() {
    setPhase("question");
    setIndex(0);
    setAnswers({});
    setSelected(null);
    setRevealed(false);
  }

  function handleSelect(optionId: string) {
    if (revealed) return;
    setSelected(optionId);
  }

  function handleCheck() {
    if (!question || !selected) return;
    setAnswers((prev) => ({ ...prev, [question.id]: selected }));
    setRevealed(true);
  }

  function handleNext() {
    if (index >= total - 1) {
      setPhase("results");
      return;
    }
    setIndex((i) => i + 1);
    setSelected(null);
    setRevealed(false);
  }

  if (phase === "intro") {
    return (
      <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8">
        <p className="text-sm text-[var(--color-text-muted)]">
          {total} questions · ~{quiz.estimatedMinutes} minutes · No login · No
          timer
        </p>
        <ul className="mt-6 space-y-2 text-sm text-[var(--color-text-muted)]">
          <li>• KaTeX formulas where needed</li>
          <li>• Instant explanation after each answer</li>
          <li>• Topic-wise score breakdown at the end</li>
        </ul>
        <Button
          type="button"
          variant="primary"
          size="lg"
          className="mt-8"
          onClick={startQuiz}
        >
          Start quiz
        </Button>
      </div>
    );
  }

  if (phase === "results") {
    return (
      <QuizResults quiz={quiz} answers={answers} onRetry={resetAttempt} />
    );
  }

  if (!question) return null;

  const progress = ((index + (revealed ? 1 : 0)) / total) * 100;

  return (
    <div>
      <div className="mb-6">
        <div className="flex justify-between text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
          <span>
            Question {index + 1} of {total}
          </span>
          <span>{question.topic}</span>
        </div>
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-alt)]"
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-[var(--color-primary-500)] transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <QuestionView
        question={question}
        selected={selected}
        revealed={revealed}
        onSelect={handleSelect}
      />

      <div className="mt-8 flex flex-wrap gap-3">
        {!revealed ? (
          <Button
            type="button"
            variant="primary"
            size="lg"
            disabled={!selected}
            onClick={handleCheck}
          >
            Check answer
          </Button>
        ) : (
          <Button
            type="button"
            variant="primary"
            size="lg"
            onClick={handleNext}
          >
            {index >= total - 1 ? "See results" : "Next question"}
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}

type QuestionViewProps = {
  question: QuizQuestion;
  selected: string | null;
  revealed: boolean;
  onSelect: (id: string) => void;
};

function QuestionView({
  question,
  selected,
  revealed,
  onSelect,
}: QuestionViewProps) {
  const isCorrect = selected === question.correctOptionId;

  return (
    <div>
      <h2 className="font-display text-xl font-bold text-[var(--color-text)]">
        {question.prompt}
      </h2>
      {question.latex && (
        <div className="mt-4 rounded-[var(--radius-md)] bg-[var(--color-surface-alt)] px-4 py-3">
          <LatexBlock math={question.latex} display />
        </div>
      )}

      <ul
        className="mt-6 space-y-2"
        role="radiogroup"
        aria-label="Answer choices"
      >
        {question.options.map((opt) => {
          const isSelected = selected === opt.id;
          const isAnswer = opt.id === question.correctOptionId;
          let state: "default" | "selected" | "correct" | "wrong" = "default";
          if (revealed && isAnswer) state = "correct";
          else if (revealed && isSelected && !isAnswer) state = "wrong";
          else if (isSelected) state = "selected";

          return (
            <li key={opt.id}>
              <button
                type="button"
                role="radio"
                aria-checked={isSelected}
                tabIndex={isSelected ? 0 : -1}
                disabled={revealed}
                onClick={() => onSelect(opt.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-[var(--radius-lg)] border px-4 py-3 text-left text-sm transition",
                  state === "default" &&
                    "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-primary-300)]",
                  state === "selected" &&
                    "border-[var(--color-primary-400)] bg-[var(--color-primary-50)]",
                  state === "correct" &&
                    "border-[var(--color-success)] bg-green-50 dark:bg-green-950/30",
                  state === "wrong" &&
                    "border-[var(--color-error)] bg-red-50 dark:bg-red-950/30",
                )}
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold",
                    state === "correct" &&
                      "border-[var(--color-success)] text-[var(--color-success)]",
                    state === "wrong" &&
                      "border-[var(--color-error)] text-[var(--color-error)]",
                    state !== "correct" &&
                      state !== "wrong" &&
                      "border-[var(--color-border)] text-[var(--color-text-muted)]",
                  )}
                >
                  {opt.id.toUpperCase()}
                </span>
                <span className="flex-1 text-[var(--color-text)]">
                  {opt.latex ? (
                    <LatexBlock math={opt.latex} />
                  ) : (
                    opt.label
                  )}
                </span>
                {revealed && isAnswer && (
                  <CheckCircle2
                    className="size-5 shrink-0 text-[var(--color-success)]"
                    aria-hidden
                  />
                )}
                {revealed && isSelected && !isAnswer && (
                  <XCircle
                    className="size-5 shrink-0 text-[var(--color-error)]"
                    aria-hidden
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {revealed && (
        <div
          className={cn(
            "mt-6 rounded-[var(--radius-lg)] border px-5 py-4",
            isCorrect
              ? "border-[var(--color-success)]/40 bg-green-50/80 dark:bg-green-950/20"
              : "border-[var(--color-error)]/40 bg-red-50/80 dark:bg-red-950/20",
          )}
          role="status"
        >
          <p className="font-semibold text-[var(--color-text)]">
            {isCorrect ? "Correct!" : "Not quite — here's why"}
          </p>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            {question.explanation}
          </p>
          {question.explanationLatex && (
            <div className="mt-3">
              <LatexBlock math={question.explanationLatex} display />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
