import { LatexBlock } from "@/components/math/latex-block";
import { deleteQuestion } from "@/app/(admin)/admin/exams/actions";
import { optionsFromJson, type QuestionRow } from "@/lib/exams/admin-data";
import { Button } from "@/components/ui/button";

type QuestionsListProps = {
  examId: string;
  questions: QuestionRow[];
};

export function QuestionsList({ examId, questions }: QuestionsListProps) {
  if (questions.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">
        No questions yet. Add your first question below.
      </p>
    );
  }

  return (
    <ul className="space-y-4">
      {questions.map((q) => {
        const options = optionsFromJson(q.options);
        return (
          <li
            key={q.id}
            className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-xs font-semibold text-[var(--color-text-faint)]">
                Q{q.position}
                {q.section ? ` · ${q.section}` : ""}
                {q.topic ? ` · ${q.topic}` : ""}
              </p>
              <form
                action={async () => {
                  "use server";
                  await deleteQuestion(examId, q.id);
                }}
              >
                <Button type="submit" variant="ghost" size="sm">
                  Remove
                </Button>
              </form>
            </div>
            <div className="mt-2">
              <LatexBlock math={q.question_latex} display />
            </div>
            <ol className="mt-3 grid gap-2 sm:grid-cols-2">
              {options.map((opt, i) => (
                <li
                  key={i}
                  className={`rounded-md border px-3 py-2 text-sm ${
                    i === q.correct_idx
                      ? "border-[var(--color-success)] bg-green-50/80 dark:bg-green-950/30"
                      : "border-[var(--color-border)]"
                  }`}
                >
                  <span className="mr-2 font-mono text-xs text-[var(--color-text-faint)]">
                    {String.fromCharCode(65 + i)}.
                  </span>
                  <LatexBlock math={opt} display={false} />
                </li>
              ))}
            </ol>
            {q.explanation_latex && (
              <div className="mt-3 border-t border-[var(--color-border)] pt-3">
                <p className="text-xs text-[var(--color-text-faint)]">Explanation</p>
                <LatexBlock math={q.explanation_latex} display={false} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
