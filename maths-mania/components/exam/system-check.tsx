"use client";

import * as React from "react";
import { Check, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

type CheckResult = {
  id: string;
  label: string;
  ok: boolean;
  warning?: string;
};

function runChecks(): CheckResult[] {
  const results: CheckResult[] = [];

  results.push({
    id: "viewport",
    label: "Screen at least 768px wide",
    ok: typeof window !== "undefined" && window.innerWidth >= 768,
    warning: "Use a tablet or laptop. Phones cannot host the full exam UI.",
  });

  results.push({
    id: "fullscreen",
    label: "Fullscreen API supported",
    ok:
      typeof document !== "undefined" &&
      typeof document.documentElement.requestFullscreen === "function",
    warning: "Your browser does not support fullscreen. Try Chrome or Edge.",
  });

  let storageOk = false;
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("__mm_probe", "1");
      window.localStorage.removeItem("__mm_probe");
      storageOk = true;
    }
  } catch {
    storageOk = false;
  }
  results.push({
    id: "storage",
    label: "Local storage available",
    ok: storageOk,
    warning:
      "Enable cookies and local storage for this site. Autosave will not work otherwise.",
  });

  results.push({
    id: "online",
    label: "Internet connection",
    ok: typeof navigator !== "undefined" ? navigator.onLine : true,
    warning: "You appear to be offline. Reconnect before starting.",
  });

  return results;
}

type SystemCheckProps = {
  onReady?: (ready: boolean) => void;
  className?: string;
};

export function SystemCheck({ onReady, className }: SystemCheckProps) {
  const [results, setResults] = React.useState<CheckResult[]>([]);

  React.useEffect(() => {
    // Defer the first read to a microtask so the effect body doesn't
    // call setState synchronously (avoids cascading-render lint rule).
    const handleOnline = () => setResults(runChecks());
    queueMicrotask(handleOnline);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOnline);
    };
  }, []);

  const ready = results.length > 0 && results.every((r) => r.ok);
  const onReadyRef = React.useRef(onReady);
  React.useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);
  React.useEffect(() => {
    onReadyRef.current?.(ready);
  }, [ready]);

  return (
    <div
      className={cn("space-y-2", className)}
      role="status"
      aria-live="polite"
      aria-label="System check"
    >
      {results.map((r) => (
        <div
          key={r.id}
          className={cn(
            "flex items-start gap-3 rounded-[var(--radius-md)] border px-4 py-3 text-sm",
            r.ok
              ? "border-[var(--color-success)]/40 bg-green-50/60 dark:bg-green-950/20"
              : "border-[var(--color-error)]/40 bg-red-50/60 dark:bg-red-950/20",
          )}
        >
          {r.ok ? (
            <Check
              className="mt-0.5 size-4 shrink-0 text-[var(--color-success)]"
              aria-hidden
            />
          ) : (
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0 text-[var(--color-error)]"
              aria-hidden
            />
          )}
          <div>
            <p className="font-medium text-[var(--color-text)]">{r.label}</p>
            {!r.ok && r.warning && (
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                {r.warning}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
