import * as React from "react";
import { cn } from "@/lib/utils";
import type { PillarSlug } from "@/lib/site";

const ICONS: Record<PillarSlug, React.ReactNode> = {
  school: (
    <path
      d="M12 3L2 8l10 5 10-5-10-5zM4 10v6l8 4 8-4v-6M12 13v6"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  ),
  banking: (
    <>
      <rect x="3" y="8" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="2" fill="none" />
      <path d="M3 12h18M7 16h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  ssc: (
    <>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" fill="none" />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" fill="none" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  tricks: (
    <path
      d="M12 2l2.4 7.4H22l-6 4.6 2.3 7-6.3-4.6L6 21l2.3-7-6-4.6h7.6L12 2z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      fill="none"
    />
  ),
  exams: (
    <>
      <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M6 9h12v8H6V9zM8 5h8l1 4H7l1-4z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        fill="none"
      />
    </>
  ),
};

export function PillarIcon({
  slug,
  className,
}: {
  slug: PillarSlug;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("size-8", className)}
      aria-hidden
    >
      {ICONS[slug]}
    </svg>
  );
}
