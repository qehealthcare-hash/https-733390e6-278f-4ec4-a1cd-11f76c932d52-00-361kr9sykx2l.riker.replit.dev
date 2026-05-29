"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SystemCheck } from "@/components/exam/system-check";
import { cn } from "@/lib/utils";

type LobbyPanelProps = {
  examSlug: string;
  startsAtIso: string;
  endsAtIso: string;
  /** Server time at render — used to compute clock offset. */
  serverNowIso: string;
  className?: string;
};

function pad(n: number): string {
  return String(Math.max(0, n)).padStart(2, "0");
}

function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

/**
 * LobbyPanel — server-anchored countdown to exam start with a system check
 * and "Enter exam" button that unlocks once start time has passed.
 */
export function LobbyPanel({
  examSlug,
  startsAtIso,
  endsAtIso,
  serverNowIso,
  className,
}: LobbyPanelProps) {
  const router = useRouter();

  const serverNowMs = React.useMemo(
    () => new Date(serverNowIso).getTime(),
    [serverNowIso],
  );
  const startsAt = React.useMemo(() => new Date(startsAtIso).getTime(), [startsAtIso]);
  const endsAt = React.useMemo(() => new Date(endsAtIso).getTime(), [endsAtIso]);

  // Seed with server-anchored time; client-side ticker swaps to Date.now+offset.
  const [now, setNow] = React.useState(serverNowMs);
  const [systemReady, setSystemReady] = React.useState(false);
  const [entering, setEntering] = React.useState(false);

  React.useEffect(() => {
    const offset = serverNowMs - Date.now();
    const id = window.setInterval(
      () => setNow(Date.now() + offset),
      1000,
    );
    return () => window.clearInterval(id);
  }, [serverNowMs]);

  const msToStart = startsAt - now;
  const msToEnd = endsAt - now;
  const examStarted = msToStart <= 0;
  const examEnded = msToEnd <= 0;
  const enterEnabled = examStarted && !examEnded && systemReady;

  const handleEnter = React.useCallback(async () => {
    setEntering(true);
    // Request fullscreen in this user-gesture handler so the attempt page
    // starts already in fullscreen mode (browsers block auto-fullscreen).
    try {
      const el = document.documentElement;
      if (el.requestFullscreen) await el.requestFullscreen();
    } catch {
      /* user cancelled fullscreen — they can re-enter from the banner */
    }
    router.push(`/exams/${examSlug}/attempt`);
  }, [examSlug, router]);

  return (
    <div className={cn("space-y-8", className)}>
      <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center shadow-[var(--shadow-card)]">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          {examEnded
            ? "Exam window closed"
            : examStarted
              ? "Exam is live — enter now"
              : "Exam starts in"}
        </p>
        <p
          className="mt-3 font-mono text-4xl font-bold tabular-nums tracking-tight text-[var(--color-text)] sm:text-5xl"
          role="timer"
          aria-live="polite"
          aria-atomic="true"
          aria-label={
            examEnded
              ? "Exam ended"
              : examStarted
                ? `Time remaining: ${fmtDuration(msToEnd)}`
                : `Starts in: ${fmtDuration(msToStart)}`
          }
        >
          {examEnded
            ? "—"
            : examStarted
              ? fmtDuration(msToEnd)
              : fmtDuration(msToStart)}
        </p>
        {!examStarted && (
          <p className="mt-3 text-xs text-[var(--color-text-faint)]">
            Door opens automatically — keep this tab open.
          </p>
        )}
      </div>

      <div>
        <h2 className="font-display text-lg font-bold text-[var(--color-text)]">
          System check
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          We need a few things in place before you enter.
        </p>
        <SystemCheck className="mt-4" onReady={setSystemReady} />
      </div>

      <div>
        <h2 className="font-display text-lg font-bold text-[var(--color-text)]">
          House rules
        </h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[var(--color-text-muted)]">
          <li>Stay in fullscreen for the full attempt. Exiting is logged.</li>
          <li>
            Switching tabs, copy, paste, and right-click are disabled and
            recorded.
          </li>
          <li>Auto-submit fires the moment the timer hits zero.</li>
          <li>
            Every answer autosaves — refresh and you will resume exactly where
            you left off.
          </li>
        </ul>
      </div>

      <Button
        type="button"
        variant="primary"
        size="lg"
        disabled={!enterEnabled || entering}
        onClick={() => void handleEnter()}
        className="w-full sm:w-auto"
      >
        {entering ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden /> Entering exam…
          </>
        ) : examEnded ? (
          "Exam window closed"
        ) : !examStarted ? (
          "Waiting for start…"
        ) : !systemReady ? (
          "Pass the system check first"
        ) : (
          "Enter exam →"
        )}
      </Button>
    </div>
  );
}
