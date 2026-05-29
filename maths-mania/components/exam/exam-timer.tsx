"use client";

import * as React from "react";
import { Timer } from "lucide-react";
import { cn } from "@/lib/utils";

type ExamTimerProps = {
  /** Server-anchored deadline (UTC ISO). */
  endsAtIso: string;
  /** Server time at the moment the parent computed offset (UTC ISO). */
  serverAnchorIso: string;
  /** Called once when remaining hits zero. */
  onExpire: () => void;
  className?: string;
};

function pad(n: number): string {
  return String(Math.max(0, n)).padStart(2, "0");
}

function fmt(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

export function ExamTimer({
  endsAtIso,
  serverAnchorIso,
  onExpire,
  className,
}: ExamTimerProps) {
  const endsAt = React.useMemo(() => new Date(endsAtIso).getTime(), [endsAtIso]);
  const serverAnchorMs = React.useMemo(
    () => new Date(serverAnchorIso).getTime(),
    [serverAnchorIso],
  );

  // Server-anchored initial value avoids hydration mismatch.
  const [remaining, setRemaining] = React.useState(
    Math.max(0, endsAt - serverAnchorMs),
  );
  const firedRef = React.useRef(false);
  const onExpireRef = React.useRef(onExpire);
  React.useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  React.useEffect(() => {
    const offset = serverAnchorMs - Date.now();
    const id = window.setInterval(() => {
      const r = Math.max(0, endsAt - (Date.now() + offset));
      setRemaining(r);
      if (r <= 0 && !firedRef.current) {
        firedRef.current = true;
        onExpireRef.current();
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [endsAt, serverAnchorMs]);

  const danger = remaining > 0 && remaining < 60_000;
  const warn = remaining > 0 && remaining < 5 * 60_000;

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full border px-4 py-2 font-mono text-lg font-bold tabular-nums",
        danger
          ? "border-[var(--color-error)] bg-[var(--color-error-bg)] text-[var(--color-error)]"
          : warn
            ? "border-orange-500/40 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300"
            : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]",
        className,
      )}
      role="timer"
      aria-live={danger ? "assertive" : warn ? "polite" : "off"}
      aria-atomic="true"
      aria-label={`Time remaining: ${fmt(remaining)}`}
    >
      <Timer className="size-4" aria-hidden />
      <span aria-hidden>{fmt(remaining)}</span>
    </div>
  );
}
