import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatExamScheduleIST } from "@/lib/exams/public";
import type { DashboardAttempt } from "@/lib/dashboard";
import { cn } from "@/lib/utils";

type AttemptRowProps = {
  attempt: DashboardAttempt;
  className?: string;
};

function statusLabel(attempt: DashboardAttempt): string {
  if (attempt.status === "in_progress") return "In progress";
  if (attempt.status === "graded" && attempt.all_india_rank != null) {
    return `AIR #${attempt.all_india_rank}`;
  }
  if (attempt.status === "submitted") return "Submitted";
  return attempt.status;
}

export function AttemptRow({ attempt, className }: AttemptRowProps) {
  const href =
    attempt.status === "in_progress"
      ? `/exams/${attempt.exam.slug}/attempt`
      : `/dashboard/attempts/${attempt.id}`;

  return (
    <Link
      href={href}
      className={cn(
        "flex items-center justify-between gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4 transition hover:border-[var(--color-primary-300)]",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="font-medium text-[var(--color-text)]">{attempt.exam.title}</p>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {attempt.submitted_at
            ? formatExamScheduleIST(attempt.submitted_at)
            : formatExamScheduleIST(attempt.started_at)}
          {attempt.final_score != null && (
            <>
              {" "}
              · Score{" "}
              <span className="font-mono tabular-nums">
                {Number(attempt.final_score).toFixed(2)}
              </span>
            </>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-sm">
        <span className="font-semibold text-[var(--color-primary-600)]">
          {statusLabel(attempt)}
        </span>
        <ChevronRight className="size-4 text-[var(--color-text-faint)]" aria-hidden />
      </div>
    </Link>
  );
}
