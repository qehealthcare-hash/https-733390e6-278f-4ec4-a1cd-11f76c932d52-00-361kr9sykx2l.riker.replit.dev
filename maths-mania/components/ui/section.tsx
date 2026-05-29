import * as React from "react";
import { cn } from "@/lib/utils";

type SectionProps = React.HTMLAttributes<HTMLElement> & {
  /** Background variant. `alt` uses surface-alt; `dark` flips text. */
  tone?: "default" | "alt" | "dark" | "notebook";
  /** Vertical padding preset. */
  padding?: "none" | "sm" | "md" | "lg";
};

const TONE_CLASS: Record<NonNullable<SectionProps["tone"]>, string> = {
  default: "bg-[var(--color-bg)] text-[var(--color-text)]",
  alt: "bg-[var(--color-surface-alt)] text-[var(--color-text)]",
  dark:
    "bg-[var(--color-neutral-900)] text-[var(--color-neutral-50)] [--color-text:var(--color-neutral-50)] [--color-text-muted:var(--color-neutral-300)]",
  notebook: "bg-notebook text-[var(--color-text)]",
};

const PADDING_CLASS: Record<NonNullable<SectionProps["padding"]>, string> = {
  none: "",
  sm: "py-12 sm:py-16",
  md: "py-16 sm:py-20 md:py-24",
  lg: "py-20 sm:py-24 md:py-28 lg:py-32",
};

/**
 * Section — semantic <section> with consistent vertical rhythm and tone variants.
 * Use as the outer wrapper for every full-bleed strip on a marketing page.
 */
export function Section({
  tone = "default",
  padding = "lg",
  className,
  children,
  ...rest
}: SectionProps) {
  return (
    <section
      className={cn(TONE_CLASS[tone], PADDING_CLASS[padding], "relative", className)}
      {...rest}
    >
      {children}
    </section>
  );
}
