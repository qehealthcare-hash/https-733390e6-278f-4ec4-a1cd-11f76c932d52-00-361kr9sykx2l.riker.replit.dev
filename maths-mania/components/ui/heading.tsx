import * as React from "react";
import { cn } from "@/lib/utils";

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
type HeadingSize = "display" | "h1" | "h2" | "h3" | "h4";

type HeadingProps = Omit<React.HTMLAttributes<HTMLHeadingElement>, "size"> & {
  as?: `h${HeadingLevel}`;
  size?: HeadingSize;
  /** Use the editorial serif (Fraunces). Default true for h1/h2/display. */
  serif?: boolean;
  /** Center-align on all breakpoints. */
  center?: boolean;
  /** Apply tight letter-spacing (only sensible on large sizes). */
  tight?: boolean;
};

const SIZE_CLASS: Record<HeadingSize, string> = {
  display:
    "text-[length:var(--text-display)] leading-[1.04] tracking-[-0.03em] font-extrabold",
  h1: "text-[length:var(--text-h1)] leading-[1.08] tracking-[-0.025em] font-bold",
  h2: "text-[length:var(--text-h2)] leading-[1.15] tracking-[-0.02em] font-bold",
  h3: "text-[length:var(--text-h3)] leading-[1.25] tracking-[-0.01em] font-semibold",
  h4: "text-xl leading-[1.3] font-semibold",
};

/**
 * Heading — typographic primitive that decouples semantics (`as`) from visual
 * scale (`size`). Defaults to the editorial Fraunces serif for h1/h2/display.
 */
export function Heading({
  as: As = "h2",
  size,
  serif,
  center,
  tight,
  className,
  children,
  ...rest
}: HeadingProps) {
  // Auto-pick a size from the semantic level if `size` is not provided.
  const resolvedSize: HeadingSize =
    size ?? ((As === "h1" ? "h1" : As === "h2" ? "h2" : As === "h3" ? "h3" : "h4") as HeadingSize);

  // Default serif on big headings unless explicitly overridden.
  const isSerif =
    serif ?? (resolvedSize === "display" || resolvedSize === "h1" || resolvedSize === "h2");

  return (
    <As
      className={cn(
        SIZE_CLASS[resolvedSize],
        isSerif && "font-display",
        center && "text-center",
        tight && "tracking-[-0.04em]",
        "text-balance",
        className,
      )}
      {...rest}
    >
      {children}
    </As>
  );
}
