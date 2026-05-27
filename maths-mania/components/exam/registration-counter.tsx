"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { formatIndianNumber } from "@/lib/utils";
import { cn } from "@/lib/utils";

type RegistrationCounterProps = {
  examId: string;
  initialCount: number;
  className?: string;
};

/**
 * Live registration count via Supabase Realtime on exam_public_stats.
 * Falls back to initialCount when Realtime is unavailable.
 */
export function RegistrationCounter({
  examId,
  initialCount,
  className,
}: RegistrationCounterProps) {
  const [count, setCount] = React.useState(initialCount);

  React.useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;

    const channel = supabase
      .channel(`exam-stats-${examId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "exam_public_stats",
          filter: `exam_id=eq.${examId}`,
        },
        (payload) => {
          const row = payload.new as { registration_count?: number };
          if (typeof row.registration_count === "number") {
            setCount(row.registration_count);
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [examId]);

  return (
    <p className={cn("font-mono text-sm text-[var(--color-text-muted)]", className)}>
      <span className="font-semibold text-[var(--color-text)]">
        {formatIndianNumber(count)}
      </span>{" "}
      already registered
    </p>
  );
}
