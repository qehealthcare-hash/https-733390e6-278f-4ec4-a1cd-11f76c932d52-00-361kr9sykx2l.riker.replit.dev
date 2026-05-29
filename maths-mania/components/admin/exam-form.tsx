"use client";

import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import type { ExamRow } from "@/lib/exams/admin-data";
import {
  createExam,
  updateExam,
  type ActionState,
} from "@/app/(admin)/admin/exams/actions";
import { toIstDatetimeLocal } from "@/lib/exams/format";
import { Button } from "@/components/ui/button";
import type { ExamDifficulty, ExamPillar, ExamStatus } from "@/lib/database.types";

type ExamFormProps = {
  exam?: ExamRow;
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="md" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

const inputClass =
  "mt-1.5 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm";

export function ExamForm({ exam }: ExamFormProps) {
  const isEdit = Boolean(exam);
  const action = isEdit
    ? updateExam.bind(null, exam!.id)
    : createExam;

  const [state, formAction] = useFormState<ActionState, FormData>(action, {});

  const defaultStarts = exam ? toIstDatetimeLocal(exam.starts_at) : "";
  const defaultEnds = exam ? toIstDatetimeLocal(exam.ends_at) : "";
  const defaultRegOpen = exam
    ? toIstDatetimeLocal(exam.registration_opens_at)
    : "";
  const defaultRegClose = exam
    ? toIstDatetimeLocal(exam.registration_closes_at)
    : "";

  return (
    <form action={formAction} className="space-y-6">
      {state.error && (
        <p className="text-sm text-[var(--color-error)]" role="alert">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="text-sm text-[var(--color-success)]" role="status">
          Exam saved.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="title" className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Title
          </label>
          <input id="title" name="title" required defaultValue={exam?.title ?? ""} className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="slug" className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Slug
          </label>
          <input id="slug" name="slug" defaultValue={exam?.slug ?? ""} placeholder="auto-from-title" className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="description" className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Description
          </label>
          <textarea id="description" name="description" rows={3} defaultValue={exam?.description ?? ""} className={inputClass} />
        </div>
        <div>
          <label htmlFor="pillar" className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Pillar
          </label>
          <select id="pillar" name="pillar" defaultValue={exam?.pillar ?? "banking"} className={inputClass}>
            {(["school", "banking", "ssc", "tricks", "mixed"] as ExamPillar[]).map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="difficulty" className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Difficulty
          </label>
          <select id="difficulty" name="difficulty" defaultValue={exam?.difficulty ?? "medium"} className={inputClass}>
            {(["easy", "medium", "hard"] as ExamDifficulty[]).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="status" className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Status
          </label>
          <select id="status" name="status" defaultValue={exam?.status ?? "draft"} className={inputClass}>
            {(["draft", "scheduled", "live", "closed", "merit_published", "archived"] as ExamStatus[]).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="durationMin" className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Duration (minutes)
          </label>
          <input id="durationMin" name="durationMin" type="number" min={1} required defaultValue={exam?.duration_min ?? 30} className={inputClass} />
        </div>
        <div>
          <label htmlFor="totalMarks" className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Total marks
          </label>
          <input id="totalMarks" name="totalMarks" type="number" min={1} required defaultValue={exam?.total_marks ?? 20} className={inputClass} />
        </div>
      </div>

      <fieldset className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
        <legend className="px-1 text-sm font-semibold text-[var(--color-text)]">Marking scheme</legend>
        <div className="mt-2 grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="markingCorrect" className="text-xs text-[var(--color-text-muted)]">Correct</label>
            <input id="markingCorrect" name="markingCorrect" type="number" step="0.25" defaultValue={exam?.marking_correct ?? 1} className={inputClass} />
          </div>
          <div>
            <label htmlFor="markingWrong" className="text-xs text-[var(--color-text-muted)]">Wrong</label>
            <input id="markingWrong" name="markingWrong" type="number" step="0.25" defaultValue={exam?.marking_wrong ?? -0.25} className={inputClass} />
          </div>
          <div>
            <label htmlFor="markingSkip" className="text-xs text-[var(--color-text-muted)]">Skipped</label>
            <input id="markingSkip" name="markingSkip" type="number" step="0.25" defaultValue={exam?.marking_skip ?? 0} className={inputClass} />
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
        <legend className="px-1 text-sm font-semibold text-[var(--color-text)]">Schedule (IST)</legend>
        <p className="mt-1 text-xs text-[var(--color-text-faint)]">Use your local browser timezone display; values stored as IST.</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="registrationOpensAt" className="text-xs text-[var(--color-text-muted)]">Registration opens</label>
            <input id="registrationOpensAt" name="registrationOpensAt" type="datetime-local" required defaultValue={defaultRegOpen} className={inputClass} />
          </div>
          <div>
            <label htmlFor="registrationClosesAt" className="text-xs text-[var(--color-text-muted)]">Registration closes</label>
            <input id="registrationClosesAt" name="registrationClosesAt" type="datetime-local" required defaultValue={defaultRegClose} className={inputClass} />
          </div>
          <div>
            <label htmlFor="startsAt" className="text-xs text-[var(--color-text-muted)]">Exam starts</label>
            <input id="startsAt" name="startsAt" type="datetime-local" required defaultValue={defaultStarts} className={inputClass} />
          </div>
          <div>
            <label htmlFor="endsAt" className="text-xs text-[var(--color-text-muted)]">Exam ends</label>
            <input id="endsAt" name="endsAt" type="datetime-local" required defaultValue={defaultEnds} className={inputClass} />
          </div>
        </div>
      </fieldset>

      <div>
        <label htmlFor="rulesMd" className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          Rules (markdown)
        </label>
        <textarea id="rulesMd" name="rulesMd" rows={4} defaultValue={exam?.rules_md ?? ""} className={inputClass} />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isFree" defaultChecked={exam?.is_free ?? true} className="size-4 rounded" />
        Free exam
      </label>

      <div className="flex flex-wrap gap-3">
        <SubmitButton label={isEdit ? "Save exam" : "Create exam"} />
        <Button variant="outline" size="md" asChild>
          <Link href="/admin/exams">Cancel</Link>
        </Button>
      </div>

      {isEdit && (
        <div className="border-t border-[var(--color-border)] pt-6">
          <p className="text-sm text-[var(--color-text-muted)]">
            Public URL when scheduled:{" "}
            <Link href={`/exams/${exam!.slug}`} className="font-semibold text-[var(--color-primary-600)]">
              /exams/{exam!.slug}
            </Link>
          </p>
        </div>
      )}
    </form>
  );
}
