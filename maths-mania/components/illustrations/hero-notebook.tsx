import { cn } from "@/lib/utils";

/**
 * Hand-drawn notebook page with formulas — brand motif per §4.2.
 * The tick mark uses brand red; subtle grid lines echo globals.css .bg-notebook.
 */
export function HeroNotebook({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 400 480"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-auto w-full max-w-md", className)}
      aria-hidden
    >
      <rect
        x="8"
        y="8"
        width="384"
        height="464"
        rx="12"
        fill="var(--color-surface)"
        stroke="var(--color-border)"
        strokeWidth="2"
      />
      {/* Red margin line */}
      <line
        x1="48"
        y1="24"
        x2="48"
        y2="456"
        stroke="oklch(62% 0.21 25 / 0.35)"
        strokeWidth="2"
      />
      {/* Ruled lines */}
      {Array.from({ length: 18 }).map((_, i) => (
        <line
          key={i}
          x1="24"
          y1={56 + i * 22}
          x2="376"
          y2={56 + i * 22}
          stroke="var(--color-border)"
          strokeWidth="1"
          opacity="0.6"
        />
      ))}
      {/* Formula: (a+b)² */}
      <text
        x="72"
        y="100"
        fontFamily="var(--font-mono), monospace"
        fontSize="18"
        fill="var(--color-text)"
      >
        (a + b)² = a² + 2ab + b²
      </text>
      {/* π approximation */}
      <text
        x="72"
        y="145"
        fontFamily="var(--font-mono), monospace"
        fontSize="16"
        fill="var(--color-text-muted)"
      >
        π ≈ 22/7 · 3.142857…
      </text>
      {/* Mini bar chart */}
      <rect x="72" y="175" width="28" height="50" rx="4" fill="var(--color-secondary-500)" opacity="0.7" />
      <rect x="108" y="195" width="28" height="30" rx="4" fill="var(--color-primary-500)" opacity="0.85" />
      <rect x="144" y="160" width="28" height="65" rx="4" fill="var(--color-accent-500)" opacity="0.9" />
      <rect x="180" y="185" width="28" height="40" rx="4" fill="var(--color-secondary-500)" opacity="0.5" />
      {/* Tick in brand red */}
      <path
        d="M 280 220 L 300 245 L 340 190"
        stroke="oklch(62% 0.21 25)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Multiply trick scribble */}
      <text
        x="72"
        y="280"
        fontFamily="var(--font-mono), monospace"
        fontSize="15"
        fill="var(--color-text)"
      >
        34 × 11 → 3 | 7 | 4 = 374
      </text>
      <text
        x="72"
        y="320"
        fontFamily="var(--font-sans), sans-serif"
        fontSize="13"
        fill="var(--color-text-muted)"
        fontStyle="italic"
      >
        step-by-step · no magic, just method
      </text>
    </svg>
  );
}
