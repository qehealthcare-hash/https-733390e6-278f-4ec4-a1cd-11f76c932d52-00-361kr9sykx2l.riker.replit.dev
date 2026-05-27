"use client";

import * as React from "react";
import { LatexBlock } from "@/components/math/latex-block";
import { cn } from "@/lib/utils";

type LatexPreviewProps = {
  latex: string;
  label?: string;
  display?: boolean;
  className?: string;
};

/** Live KaTeX preview for admin question authoring. */
export function LatexPreview({
  latex,
  label = "Preview",
  display = true,
  className,
}: LatexPreviewProps) {
  const trimmed = latex.trim();

  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-alt)] px-4 py-3",
        className,
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">
        {label}
      </p>
      {trimmed ? (
        <div className="mt-2 min-h-[2.5rem]">
          <LatexBlock math={trimmed} display={display} />
        </div>
      ) : (
        <p className="mt-2 text-sm italic text-[var(--color-text-faint)]">
          Type LaTeX above to preview.
        </p>
      )}
    </div>
  );
}
