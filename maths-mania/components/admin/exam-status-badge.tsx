import type { ExamStatus } from "@/lib/database.types";
import { formatExamStatus } from "@/lib/exams/format";
import { cn } from "@/lib/utils";

const STYLES: Record<ExamStatus, string> = {
  draft: "bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200",
  scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  live: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  closed: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  merit_published: "bg-[var(--color-primary-100)] text-[var(--color-primary-800)]",
  archived: "bg-neutral-100 text-neutral-600",
};

export function ExamStatusBadge({
  status,
  className,
}: {
  status: ExamStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold",
        STYLES[status],
        className,
      )}
    >
      {formatExamStatus(status)}
    </span>
  );
}
