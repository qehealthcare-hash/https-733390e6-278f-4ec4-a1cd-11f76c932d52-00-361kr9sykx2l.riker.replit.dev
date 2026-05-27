"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type CountdownTimerProps = {
  /** ISO timestamp to count down to. */
  targetIso: string;
  /** Show days in the display (DD : HH : MM : SS). */
  showDays?: boolean;
  className?: string;
  /** Compact mono display for overlay cards. */
  size?: "sm" | "md" | "lg";
};

function pad(n: number): string {
  return String(Math.max(0, n)).padStart(2, "0");
}

function getParts(ms: number, showDays: boolean) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (showDays) {
    return { days, hours, minutes, seconds };
  }
  const totalHours = Math.floor(totalSec / 3600);
  return { days: 0, hours: totalHours, minutes, seconds };
}

/**
 * CountdownTimer — ticks every second toward a target instant.
 * Marketing hero uses client clock; live exam lobby will use
 * server-anchored offset (milestone 12).
 */
export function CountdownTimer({
  targetIso,
  showDays = true,
  className,
  size = "md",
}: CountdownTimerProps) {
  const target = React.useMemo(() => new Date(targetIso).getTime(), [targetIso]);
  const [remaining, setRemaining] = React.useState(() =>
    Math.max(0, target - Date.now()),
  );

  React.useEffect(() => {
    const tick = () => setRemaining(Math.max(0, target - Date.now()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [target]);

  const parts = getParts(remaining, showDays);
  const sizeClass =
    size === "lg"
      ? "text-3xl sm:text-4xl"
      : size === "sm"
        ? "text-sm"
        : "text-xl sm:text-2xl";

  return (
    <time
      dateTime={targetIso}
      className={cn(
        "font-mono font-bold tabular-nums tracking-tight text-[var(--color-text)]",
        sizeClass,
        className,
      )}
      aria-live="polite"
      aria-label="Time until exam start"
    >
      {showDays && (
        <>
          <span>{pad(parts.days)}</span>
          <span className="mx-1 opacity-50">:</span>
        </>
      )}
      <span>{pad(parts.hours)}</span>
      <span className="mx-1 opacity-50">:</span>
      <span>{pad(parts.minutes)}</span>
      <span className="mx-1 opacity-50">:</span>
      <span>{pad(parts.seconds)}</span>
    </time>
  );
}
