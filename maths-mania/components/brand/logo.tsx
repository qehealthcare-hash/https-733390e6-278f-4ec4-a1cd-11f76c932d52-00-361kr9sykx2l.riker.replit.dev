import * as React from "react";
import { cn } from "@/lib/utils";

type LogoProps = {
  /** Variant: full lockup (mark + wordmark) or just the mark. */
  variant?: "lockup" | "mark";
  /** Size in pixels for the mark; wordmark scales relative to it. */
  size?: number;
  className?: string;
  /** Whether to show the tagline beneath the wordmark. */
  withTagline?: boolean;
};

/**
 * Maths Mania logo — rendered as inline SVG so it tints with brand tokens
 * and stays crisp at every density. Mark is a hand-drawn π glyph wrapped
 * in the energetic Mania red.
 *
 * Until the real wordmark SVG is dropped in /public/brand/, we render the
 * brand name in Fraunces with the same red accent on "Mania" so the site
 * never ships without a credible logo.
 */
export function Logo({
  variant = "lockup",
  size = 32,
  className,
  withTagline = false,
}: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        aria-hidden
        className="grid place-items-center rounded-[var(--radius-md)] bg-[var(--color-primary-500)] text-white shadow-[var(--shadow-soft)]"
        style={{ width: size, height: size }}
      >
        <svg
          viewBox="0 0 32 32"
          width={size * 0.62}
          height={size * 0.62}
          fill="none"
        >
          {/* Stylised π — wide top stroke, two descenders, soft serif feet */}
          <path
            d="M5 10 H27"
            stroke="currentColor"
            strokeWidth="3.4"
            strokeLinecap="round"
          />
          <path
            d="M11 10 V24"
            stroke="currentColor"
            strokeWidth="3.4"
            strokeLinecap="round"
          />
          <path
            d="M21 10 V22 Q21 25 24 25"
            stroke="currentColor"
            strokeWidth="3.4"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      </span>

      {variant === "lockup" && (
        <span className="flex flex-col leading-none">
          <span className="font-display text-xl font-extrabold tracking-tight">
            <span className="text-[var(--color-text)]">Maths</span>
            <span className="text-[var(--color-primary-500)]">Mania</span>
          </span>
          {withTagline && (
            <span className="mt-1 text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
              Beyond Numbers
            </span>
          )}
        </span>
      )}
      <span className="sr-only">Maths Mania — Beyond Numbers, Your Way to Learn</span>
    </span>
  );
}
