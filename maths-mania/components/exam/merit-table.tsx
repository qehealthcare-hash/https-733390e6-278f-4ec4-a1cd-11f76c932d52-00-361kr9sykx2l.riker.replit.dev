import { cn } from "@/lib/utils";
import type { MeritRow } from "@/lib/exams/merit";

type MeritTableProps = {
  rows: MeritRow[];
  highlightAttemptId?: string | null;
  className?: string;
};

function rankAccent(rank: number | null): string {
  if (rank === 1) return "text-amber-600 dark:text-amber-400";
  if (rank === 2) return "text-neutral-500 dark:text-neutral-400";
  if (rank === 3) return "text-amber-800 dark:text-amber-600";
  return "text-[var(--color-text-muted)]";
}

export function MeritTable({
  rows,
  highlightAttemptId,
  className,
}: MeritTableProps) {
  if (rows.length === 0) {
    return (
      <p className="text-center text-[var(--color-text-muted)]">
        No ranked attempts yet.
      </p>
    );
  }

  return (
    <div
      className={cn(
        "overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-soft)]",
        className,
      )}
    >
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
            <th className="px-4 py-3 font-semibold text-[var(--color-text-muted)]">
              AIR
            </th>
            <th className="px-4 py-3 font-semibold text-[var(--color-text-muted)]">
              Name
            </th>
            <th className="px-4 py-3 font-semibold text-[var(--color-text-muted)]">
              City
            </th>
            <th className="px-4 py-3 font-semibold text-[var(--color-text-muted)]">
              State
            </th>
            <th className="px-4 py-3 font-semibold text-[var(--color-text-muted)]">
              Score
            </th>
            <th className="px-4 py-3 font-semibold text-[var(--color-text-muted)]">
              Percentile
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const rank = row.all_india_rank ?? 0;
            const isYou = highlightAttemptId === row.attempt_id;
            return (
              <tr
                key={row.attempt_id}
                className={cn(
                  "border-b border-[var(--color-border)] last:border-0",
                  isYou && "bg-[var(--color-primary-50)]/80",
                )}
              >
                <td
                  className={cn(
                    "px-4 py-3 font-mono font-bold tabular-nums",
                    rankAccent(rank),
                  )}
                >
                  #{rank}
                </td>
                <td className="px-4 py-3 font-medium text-[var(--color-text)]">
                  {row.display_name}
                  {isYou && (
                    <span className="ml-2 text-xs font-semibold text-[var(--color-primary-600)]">
                      You
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-[var(--color-text-muted)]">
                  {row.city ?? "—"}
                </td>
                <td className="px-4 py-3 text-[var(--color-text-muted)]">
                  {row.state ?? "—"}
                </td>
                <td className="px-4 py-3 font-mono tabular-nums">
                  {row.final_score != null
                    ? Number(row.final_score).toFixed(2)
                    : "—"}
                </td>
                <td className="px-4 py-3 font-mono tabular-nums text-[var(--color-text-muted)]">
                  {row.percentile != null
                    ? `${Number(row.percentile).toFixed(1)}`
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
