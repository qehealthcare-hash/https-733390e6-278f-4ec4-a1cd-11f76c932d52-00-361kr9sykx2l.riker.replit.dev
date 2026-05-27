"use client";

import * as React from "react";
import { useFormState, useFormStatus } from "react-dom";
import { addQuestion, type ActionState } from "@/app/(admin)/admin/exams/actions";
import { LatexPreview } from "@/components/admin/latex-preview";
import { LatexBlock } from "@/components/math/latex-block";
import { Button } from "@/components/ui/button";

type QuestionFormProps = {
  examId: string;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="md" disabled={pending}>
      {pending ? "Adding…" : "Add question"}
    </Button>
  );
}

const inputClass =
  "mt-1.5 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm";

export function QuestionForm({ examId }: QuestionFormProps) {
  const [questionLatex, setQuestionLatex] = React.useState("");
  const [explanationLatex, setExplanationLatex] = React.useState("");
  const [optionPreviews, setOptionPreviews] = React.useState(["", "", "", ""]);

  const boundAction = addQuestion.bind(null, examId);
  const [state, formAction] = useFormState<ActionState, FormData>(boundAction, {});

  return (
    <form action={formAction} className="space-y-4 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
      <h3 className="font-display text-lg font-bold text-[var(--color-text)]">
        Add question
      </h3>

      {state.error && (
        <p className="text-sm text-[var(--color-error)]" role="alert">{state.error}</p>
      )}
      {state.ok && (
        <p className="text-sm text-[var(--color-success)]" role="status">
          Question added.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="section" className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Section
          </label>
          <input id="section" name="section" placeholder="e.g. Arithmetic" className={inputClass} />
        </div>
        <div>
          <label htmlFor="topic" className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Topic
          </label>
          <input id="topic" name="topic" placeholder="e.g. Percentage" className={inputClass} />
        </div>
      </div>

      <div>
        <label htmlFor="questionLatex" className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          Question (LaTeX)
        </label>
        <textarea
          id="questionLatex"
          name="questionLatex"
          required
          rows={3}
          value={questionLatex}
          onChange={(e) => setQuestionLatex(e.target.value)}
          placeholder="e.g. 25\\% \\text{ of } 80 = ?"
          className={inputClass}
        />
        <LatexPreview latex={questionLatex} className="mt-3" />
      </div>

      <fieldset>
        <legend className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          Options (LaTeX or text)
        </legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {(["A", "B", "C", "D"] as const).map((label, i) => (
            <div key={label}>
              <label htmlFor={`option${i}`} className="text-xs text-[var(--color-text-muted)]">
                Option {label}
              </label>
              <input
                id={`option${i}`}
                name={`option${i}`}
                required
                value={optionPreviews[i]}
                onChange={(e) => {
                  const next = [...optionPreviews];
                  next[i] = e.target.value;
                  setOptionPreviews(next);
                }}
                className={inputClass}
              />
              {optionPreviews[i]?.trim() && (
                <div className="mt-1 scale-90 origin-left">
                  <LatexBlock math={optionPreviews[i]} display={false} />
                </div>
              )}
            </div>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="correctIdx" className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          Correct answer
        </label>
        <select id="correctIdx" name="correctIdx" required defaultValue="0" className={inputClass}>
          <option value="0">A</option>
          <option value="1">B</option>
          <option value="2">C</option>
          <option value="3">D</option>
        </select>
      </div>

      <div>
        <label htmlFor="explanationLatex" className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          Explanation (LaTeX, optional)
        </label>
        <textarea
          id="explanationLatex"
          name="explanationLatex"
          rows={2}
          value={explanationLatex}
          onChange={(e) => setExplanationLatex(e.target.value)}
          className={inputClass}
        />
        <LatexPreview latex={explanationLatex} label="Explanation preview" className="mt-3" />
      </div>

      <SubmitButton />
    </form>
  );
}
