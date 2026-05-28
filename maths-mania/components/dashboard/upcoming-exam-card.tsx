import Link from "next/link";
import { ArrowRight, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatExamScheduleIST, requestNowMs } from "@/lib/exams/public";
import type { DashboardExamLite } from "@/lib/dashboard";
import type { AttemptRow } from "@/lib/exams/attempt";

type UpcomingExamCardProps = {
  exam: DashboardExamLite;
  attempt: AttemptRow | null;
};

export function UpcomingExamCard({ exam, attempt }: UpcomingExamCardProps) {
  const now = requestNowMs();
  const start = new Date(exam.starts_at).getTime();
  const end = new Date(exam.ends_at).getTime();
  const lobbyOpen = now >= start - 15 * 60_000;
  const isLive = now >= start && now <= end;

  let href = `/exams/${exam.slug}`;
  let cta = "View details";

  if (attempt?.status === "in_progress") {
    href = `/exams/${exam.slug}/attempt`;
    cta = "Resume attempt";
  } else if (isLive || lobbyOpen) {
    href = `/exams/${exam.slug}/lobby`;
    cta = "Enter lobby";
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-primary-600)]">
        {isLive ? "Live now" : lobbyOpen ? "Lobby open" : "Registered"}
      </p>
      <h3 className="mt-1 font-display text-lg font-bold text-[var(--color-text)]">
        {exam.title}
      </h3>
      <p className="mt-1 flex items-center gap-1 text-sm text-[var(--color-text-muted)]">
        <Calendar className="size-3.5" aria-hidden />
        {formatExamScheduleIST(exam.starts_at)} · {exam.duration_min} min
      </p>
      <Button asChild size="sm" variant={isLive || lobbyOpen ? "primary" : "outline"} className="mt-4">
        <Link href={href}>
          {cta}
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </Button>
    </div>
  );
}
