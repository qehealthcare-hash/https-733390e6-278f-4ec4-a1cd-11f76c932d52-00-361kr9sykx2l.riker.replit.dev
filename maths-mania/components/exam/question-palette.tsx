"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type PaletteState = "unseen" | "unanswered" | "answered" | "review";

type QuestionPaletteProps = {
  total: number;
  currentIndex: number;
  states: PaletteState[];
  onJump: (index: number) => void;
  className?: string;
};

const STATE_CLASS: Record<PaletteState, string> = {
  unseen:
    "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)]",
  unanswered:
    "border-[var(--color-error)]/50 bg-[var(--color-error-bg)]/50 text-[var(--color-text)]",
  answered:
    "border-[var(--color-success)]/60 bg-[var(--color-success-bg)]/60 text-[var(--color-text)]",
  review:
    "border-[var(--color-primary-500)] bg-[var(--color-primary-50)] text-[var(--color-text)]",
};

export function QuestionPalette({
  total,
  currentIndex,
  states,
  onJump,
  className,
}: QuestionPaletteProps) {
  return (
    <nav className={cn("space-y-3", className)} aria-label="Question navigator">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
        Questions
      </p>
      <div className="grid grid-cols-5 gap-2">
        {Array.from({ length: total }, (_, i) => {
          const state = states[i] ?? "unseen";
          const isCurrent = i === currentIndex;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onJump(i)}
              aria-current={isCurrent ? "true" : undefined}
              aria-label={`Question ${i + 1} (${state})`}
              className={cn(
                "flex h-9 items-center justify-center rounded-md border text-sm font-semibold transition",
                STATE_CLASS[state],
                isCurrent && "ring-2 ring-[var(--color-primary-500)] ring-offset-1",
              )}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1 pt-2 text-[11px] text-[var(--color-text-muted)]">
        <li className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm border border-[var(--color-success)]/60 bg-[var(--color-success-bg)]/60" />
          Answered
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm border border-[var(--color-error)]/50 bg-[var(--color-error-bg)]/50" />
          Skipped
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm border border-[var(--color-primary-500)] bg-[var(--color-primary-50)]" />
          For review
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)]" />
          Not seen
        </li>
      </ul>
    </nav>
  );
}
