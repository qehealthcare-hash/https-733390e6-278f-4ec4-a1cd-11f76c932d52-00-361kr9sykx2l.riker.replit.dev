import { cn } from "@/lib/utils";

type StatProps = {
  label: string;
  value: string;
  className?: string;
};

export function Stat({ label, value, className }: StatProps) {
  return (
    <div className={cn(className)}>
      <dt className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-2xl font-bold tabular-nums text-[var(--color-text)]">
        {value}
      </dd>
    </div>
  );
}
