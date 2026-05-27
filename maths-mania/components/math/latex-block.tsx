import katex from "katex";
import { cn } from "@/lib/utils";

type LatexBlockProps = {
  /** Raw LaTeX string (without delimiters). */
  math: string;
  /** Display mode (block) vs inline. */
  display?: boolean;
  className?: string;
};

/**
 * LatexBlock — server-rendered KaTeX output.
 * Import katex CSS once in the layout or this component's parent section.
 */
export function LatexBlock({ math, display = false, className }: LatexBlockProps) {
  const html = katex.renderToString(math, {
    throwOnError: false,
    displayMode: display,
    output: "html",
  });

  return (
    <span
      className={cn(
        "katex-block font-mono text-[var(--color-text)]",
        display && "block py-2 text-center text-lg",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
