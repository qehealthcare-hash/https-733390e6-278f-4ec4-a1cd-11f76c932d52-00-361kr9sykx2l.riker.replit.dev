"use client";

import * as React from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  publishMeritAction,
  type PublishMeritState,
} from "@/app/(admin)/admin/exams/merit-actions";
import type { ExamStatus } from "@/lib/database.types";

type PublishMeritButtonProps = {
  examId: string;
  examStatus: ExamStatus;
  examEnded: boolean;
};

const initialState: PublishMeritState = {};

export function PublishMeritButton({
  examId,
  examStatus,
  examEnded,
}: PublishMeritButtonProps) {
  const [state, formAction] = useFormState(
    publishMeritAction.bind(null, examId),
    initialState,
  );

  const canPublish =
    examStatus !== "merit_published" &&
    examStatus !== "draft" &&
    examStatus !== "scheduled" &&
    examEnded;

  if (examStatus === "merit_published") {
    return (
      <p className="text-sm text-[var(--color-success)]" role="status">
        Merit list is published.
      </p>
    );
  }

  return (
    <div className="mt-6 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-muted)] p-5">
      <h3 className="font-display font-bold text-[var(--color-text)]">
        Publish merit list
      </h3>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        Computes All-India / state / city ranks, issues certificates to top
        10%, and opens the public merit page.
      </p>
      <form action={formAction} className="mt-4">
        <SubmitButton disabled={!canPublish} ended={examEnded} />
      </form>
      {!examEnded && (
        <p className="mt-2 text-xs text-[var(--color-text-faint)]">
          Available after the exam window closes.
        </p>
      )}
      {state.message && (
        <p className="mt-2 text-sm text-[var(--color-success)]" role="status">
          {state.message}
        </p>
      )}
      {state.error && (
        <p className="mt-2 text-sm text-[var(--color-error)]" role="alert">
          {state.error}
        </p>
      )}
    </div>
  );
}

function SubmitButton({
  disabled,
  ended,
}: {
  disabled: boolean;
  ended: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={disabled || pending}>
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden /> Publishing…
        </>
      ) : !ended ? (
        "Waiting for exam to end"
      ) : (
        "Publish merit & certificates"
      )}
    </Button>
  );
}
