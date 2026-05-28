import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Clock, DoorClosed, Hourglass } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { CountdownTimer } from "@/components/exam/countdown-timer";

export type ExamStatusVariant = "not_started" | "closed" | "lobby_early";

const ICONS: Record<ExamStatusVariant, LucideIcon> = {
  not_started: Hourglass,
  closed: DoorClosed,
  lobby_early: Clock,
};

type ExamStatusPanelProps = {
  variant: ExamStatusVariant;
  examTitle: string;
  examSlug: string;
  startsAtIso?: string;
  /** Shown on lobby_early — when lobby unlocks (15 min before start) */
  lobbyOpensAtIso?: string;
};

export function ExamStatusPanel({
  variant,
  examTitle,
  examSlug,
  startsAtIso,
  lobbyOpensAtIso,
}: ExamStatusPanelProps) {
  const Icon = ICONS[variant];

  const copy =
    variant === "closed"
      ? {
          title: "Exam window closed",
          body: "The timed attempt for this mock has ended. Merit lists publish within about an hour of close.",
          primary: { href: "/exams", label: "Browse other exams" },
          secondary: { href: `/exams/${examSlug}`, label: "Exam details" },
        }
      : variant === "not_started"
        ? {
            title: "Exam has not started yet",
            body: "The lobby opens 15 minutes before the scheduled start. Run your system check there, then enter when the clock hits zero.",
            primary: { href: `/exams/${examSlug}`, label: "Back to exam details" },
            secondary: { href: "/exams", label: "All exams" },
          }
        : {
            title: "Lobby opens soon",
            body: "Come back a few minutes before start to complete your system check and wait with other candidates.",
            primary: { href: `/exams/${examSlug}`, label: "Exam details" },
            secondary: { href: "/exams", label: "All exams" },
          };

  const countdownTarget =
    variant === "lobby_early"
      ? lobbyOpensAtIso
      : variant === "not_started"
        ? startsAtIso
        : undefined;

  return (
    <FadeIn className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center shadow-[var(--shadow-card)]">
      <Icon
        className="mx-auto size-12 text-[var(--color-primary-500)]"
        aria-hidden
      />
      <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
        {examTitle}
      </p>
      <Heading as="h1" size="h3" className="mt-2">
        {copy.title}
      </Heading>
      <p className="mx-auto mt-3 max-w-lg text-[var(--color-text-muted)]">
        {copy.body}
      </p>

      {countdownTarget && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">
            {variant === "lobby_early" ? "Lobby opens in" : "Starts in"}
          </p>
          <CountdownTimer targetIso={countdownTarget} size="lg" />
        </div>
      )}

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button asChild variant="primary">
          <Link href={copy.primary.href}>{copy.primary.label}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={copy.secondary.href}>{copy.secondary.label}</Link>
        </Button>
      </div>
    </FadeIn>
  );
}
