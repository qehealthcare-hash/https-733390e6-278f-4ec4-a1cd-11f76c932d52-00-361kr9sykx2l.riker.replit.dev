import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

type StatCardProps = {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  className?: string;
};

export function StatCard({ label, value, icon: Icon, className }: StatCardProps) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          {label}
        </p>
        {Icon && (
          <Icon
            className="size-4 shrink-0 text-[var(--color-primary-600)]"
            aria-hidden
          />
        )}
      </div>
      <p className="mt-2 font-display text-2xl font-bold tabular-nums text-[var(--color-text)]">
        {value}
      </p>
    </div>
  );
}
