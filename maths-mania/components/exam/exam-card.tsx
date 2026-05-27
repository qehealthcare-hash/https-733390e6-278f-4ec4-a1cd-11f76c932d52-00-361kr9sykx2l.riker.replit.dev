import Link from "next/link";
import { ArrowRight, Calendar, Clock, Users } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { CountdownTimer } from "@/components/exam/countdown-timer";
import type { PublicExam } from "@/lib/exams/public";
import { formatExamScheduleIST } from "@/lib/exams/public";
import { formatPillar, formatDifficulty } from "@/lib/exams/format";
import { formatIndianNumber } from "@/lib/utils";
import { cn } from "@/lib/utils";

type ExamCardProps = {
  exam: PublicExam;
  className?: string;
};

export function ExamCard({ exam, className }: ExamCardProps) {
  const isUpcoming = exam.status === "scheduled" || exam.status === "live";
  const href =
    exam.status === "merit_published"
      ? `/exams/${exam.slug}/merit`
      : `/exams/${exam.slug}`;

  return (
    <Card className={cn("h-full transition hover:-translate-y-0.5", className)}>
      <CardBody className="flex h-full flex-col">
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-primary-600)]">
          <span>{formatPillar(exam.pillar)}</span>
          <span className="text-[var(--color-text-faint)]">·</span>
          <span>{formatDifficulty(exam.difficulty)}</span>
          {exam.is_free && (
            <>
              <span className="text-[var(--color-text-faint)]">·</span>
              <span>Free</span>
            </>
          )}
        </div>
        <h2 className="mt-2 font-display text-xl font-bold text-[var(--color-text)]">
          <Link href={href} className="hover:text-[var(--color-primary-600)]">
            {exam.title}
          </Link>
        </h2>
        {exam.description && (
          <p className="mt-2 flex-1 text-sm text-[var(--color-text-muted)] line-clamp-3">
            {exam.description}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-3 text-xs text-[var(--color-text-faint)]">
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" aria-hidden />
            {exam.duration_min} min · {exam.question_count} Q
          </span>
          <span className="inline-flex items-center gap-1">
            <Users className="size-3.5" aria-hidden />
            {formatIndianNumber(exam.registration_count)} registered
          </span>
        </div>
        <p className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
          <Calendar className="size-3.5" aria-hidden />
          {formatExamScheduleIST(exam.starts_at)}
        </p>
        {isUpcoming && exam.status === "scheduled" && (
          <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">
              Starts in
            </p>
            <CountdownTimer
              targetIso={exam.starts_at}
              size="sm"
              showDays={false}
              className="mt-1 justify-center"
            />
          </div>
        )}
        <Link
          href={href}
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-primary-600)]"
        >
          {exam.status === "merit_published" ? "View merit list" : "View exam"}
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </CardBody>
    </Card>
  );
}
