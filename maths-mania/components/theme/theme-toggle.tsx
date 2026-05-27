"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Moon, Sun, Laptop } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMounted } from "@/lib/use-mounted";

/**
 * Three-state theme toggle: light · system · dark.
 * Renders as a small segmented pill — visible on every page.
 *
 * Hydration: on the server we render the pill in a neutral state with
 * `opacity-0`, then fade in once `useMounted` flips true. This avoids
 * the SSR/CSR mismatch that next-themes would otherwise trigger.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const mounted = useMounted();

  const options: { value: "light" | "system" | "dark"; icon: React.ReactNode; label: string }[] = [
    { value: "light", icon: <Sun className="size-3.5" aria-hidden />, label: "Light theme" },
    { value: "system", icon: <Laptop className="size-3.5" aria-hidden />, label: "System theme" },
    { value: "dark", icon: <Moon className="size-3.5" aria-hidden />, label: "Dark theme" },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5 shadow-[var(--shadow-soft)]",
        "transition-opacity duration-300",
        mounted ? "opacity-100" : "opacity-0",
        className,
      )}
    >
      {options.map((opt) => {
        const active = mounted && theme === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.label}
            title={opt.label}
            onClick={() => setTheme(opt.value)}
            className={cn(
              "flex size-7 items-center justify-center rounded-full transition-colors",
              active
                ? "bg-[var(--color-primary-500)] text-white shadow-sm"
                : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)]",
            )}
          >
            {opt.icon}
          </button>
        );
      })}
      {mounted && (
        <span className="sr-only">
          Currently {theme === "system" ? `system (${resolvedTheme})` : theme}
        </span>
      )}
    </div>
  );
}
