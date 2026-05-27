import { cn } from "@/lib/utils";

export function VideoGridSkeleton({
  count = 6,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <ul
      className={cn(
        "grid gap-6 sm:grid-cols-2 lg:grid-cols-3",
        className,
      )}
      aria-hidden
    >
      {Array.from({ length: count }).map((_, i) => (
        <li
          key={i}
          className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]"
        >
          <div className="aspect-video animate-pulse bg-[var(--color-surface-alt)]" />
          <div className="space-y-2 p-4">
            <div className="h-4 w-full animate-pulse rounded bg-[var(--color-surface-alt)]" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--color-surface-alt)]" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-[var(--color-surface-alt)]" />
          </div>
        </li>
      ))}
    </ul>
  );
}
