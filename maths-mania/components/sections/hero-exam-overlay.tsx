"use client";

import Link from "next/link";
import { CountdownTimer } from "@/components/exam/countdown-timer";
import { formatIndianNumber } from "@/lib/utils";

type HeroExamOverlayProps = {
  examTitle: string;
  startsAt: string;
  registeredCount: number;
  slug: string;
};

/** Floating "Next live exam" card on the hero illustration. */
export function HeroExamOverlay({
  examTitle,
  startsAt,
  registeredCount,
  slug,
}: HeroExamOverlayProps) {
  return (
    <Link
      href={`/exams/${slug}`}
      className="absolute right-0 top-0 max-w-[220px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]/95 p-4 shadow-[var(--shadow-pop)] backdrop-blur transition-transform hover:-translate-y-0.5 focus-visible:outline-none sm:right-4 sm:top-4"
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-primary-600)]">
        Next live exam
      </p>
      <p className="mt-1 text-sm font-semibold leading-snug text-[var(--color-text)]">
        {examTitle}
      </p>
      <p className="mt-2 text-xs text-[var(--color-text-muted)]">
        Sunday · 11:00 AM IST
      </p>
      <div className="mt-3">
        <CountdownTimer targetIso={startsAt} size="sm" />
      </div>
      <p className="mt-2 font-mono text-xs text-[var(--color-text-muted)]">
        {formatIndianNumber(registeredCount)} registered
      </p>
    </Link>
  );
}
