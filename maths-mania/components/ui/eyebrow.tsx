import * as React from "react";
import { cn } from "@/lib/utils";

type EyebrowProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: "primary" | "secondary" | "accent" | "muted";
};

const TONE: Record<NonNullable<EyebrowProps["tone"]>, string> = {
  primary: "text-[var(--color-primary-600)] bg-[var(--color-primary-50)]",
  secondary:
    "text-[var(--color-secondary-600)] bg-[var(--color-secondary-50)]",
  accent: "text-[var(--color-neutral-900)] bg-[var(--color-accent-300)]",
  muted: "text-[var(--color-text-muted)] bg-[var(--color-surface-alt)]",
};

/**
 * Eyebrow — small uppercase label that sits above headings.
 * Pill-shaped, subtle, used to anchor a section's topic.
 */
export function Eyebrow({
  tone = "primary",
  className,
  children,
  ...rest
}: EyebrowProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em]",
        TONE[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
