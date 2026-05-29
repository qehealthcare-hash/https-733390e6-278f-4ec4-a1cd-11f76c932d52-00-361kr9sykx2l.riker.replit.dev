import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ClipboardX, History } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { requireAuth } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { listUserAttempts } from "@/lib/exams/attempt";
import {
  formatExamScheduleIST,
  requestNowMs,
} from "@/lib/exams/public";
import type { Database, AttemptStatus, ExamStatus } from "@/lib/database.types";
import { cn } from "@/lib/utils";

type ExamLite = Pick<
  Database["public"]["Tables"]["exams"]["Row"],
  "id" | "slug" | "title" | "starts_at" | "ends_at" | "status" | "duration_min"
>;

type RegistrationWithExam = {
  exam: ExamLite;
};

export const metadata: Metadata = {
  title: "My exams",
};

export const dynamic = "force-dynamic";

async function getRegistrationsForUser(
  userId: string,
): Promise<RegistrationWithExam[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("exam_registrations")
    .select(
      "exam:exams(id, slug, title, starts_at, ends_at, status, duration_min)",
    )
    .eq("user_id", userId);

  if (error) {
    console.error("[dashboard] registrations", error.message);
    return [];
  }
  type Row = { exam: ExamLite | ExamLite[] | null };
  const rows = (data ?? []) as unknown as Row[];
  return rows
    .map((row) => {
      const exam = Array.isArray(row.exam) ? row.exam[0] : row.exam;
      return exam ? { exam } : null;
    })
    .filter((r): r is RegistrationWithExam => r !== null);
}

function attemptStatusLabel(s: AttemptStatus): string {
  switch (s) {
    case "in_progress":
      return "In progress";
    case "submitted":
      return "Submitted";
    case "graded":
      return "Graded";
    case "disqualified":
      return "Disqualified";
  }
}

function examStatusBadge(status: ExamStatus, startsAt: string, now: number) {
  const start = new Date(startsAt).getTime();
  if (status === "scheduled" && start - now < 15 * 60_000) return "Lobby open";
  if (status === "live") return "Live";
  if (status === "scheduled") return "Scheduled";
  if (status === "closed") return "Closed";
  if (status === "merit_published") return "Merit published";
  return "Archived";
}

export default async function DashboardExamsPage() {
  const { user } = await requireAuth({ requireOnboarded: true });

  const [registrations, attempts] = await Promise.all([
    getRegistrationsForUser(user.id),
    listUserAttempts(user.id),
  ]);

  const attemptByExam = new Map(attempts.map((a) => [a.exam_id, a]));

  const now = requestNowMs();
  const upcoming = registrations
    .filter((r) => new Date(r.exam.ends_at).getTime() >= now)
    .sort(
      (a, b) =>
        new Date(a.exam.starts_at).getTime() -
        new Date(b.exam.starts_at).getTime(),
    );
  const past = registrations
    .filter((r) => new Date(r.exam.ends_at).getTime() < now)
    .sort(
      (a, b) =>
        new Date(b.exam.starts_at).getTime() -
        new Date(a.exam.starts_at).getTime(),
    );

  return (
    <>
      <Heading as="h1" size="h2">
        My exams
      </Heading>
      <p className="mt-2 text-[var(--color-text-muted)]">
        Your registered live exams and attempts.{" "}
        <Link
          href="/exams"
          className="font-semibold text-[var(--color-primary-600)]"
        >
          Browse all →
        </Link>
      </p>

      <section className="mt-10">
        <Heading as="h2" size="h4">
          Upcoming
        </Heading>
        {upcoming.length === 0 ? (
          <EmptyState
            className="mt-4"
            icon={ClipboardX}
            title="No upcoming registrations"
            description="Reserve a seat on the next All-India mock — we'll show lobby links here when it's time."
            action={{ label: "Browse exams", href: "/exams" }}
          />
        ) : (
          <ul className="mt-4 space-y-3">
            {upcoming.map(({ exam }) => {
              const attempt = attemptByExam.get(exam.id);
              const start = new Date(exam.starts_at).getTime();
              const lobbyOpen = start - now < 15 * 60_000;
              const isLive = exam.status === "live" || (start <= now && now <= new Date(exam.ends_at).getTime());
              const href = attempt && attempt.status === "in_progress"
                ? `/exams/${exam.slug}/attempt`
                : isLive
                  ? `/exams/${exam.slug}/lobby`
                  : lobbyOpen
                    ? `/exams/${exam.slug}/lobby`
                    : `/exams/${exam.slug}`;
              const cta = attempt && attempt.status === "in_progress"
                ? "Resume attempt"
                : isLive
                  ? "Enter lobby"
                  : lobbyOpen
                    ? "Enter lobby"
                    : "View details";

              return (
                <li
                  key={exam.id}
                  className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-primary-600)]">
                        {examStatusBadge(exam.status, exam.starts_at, now)}
                      </p>
                      <h3 className="mt-1 font-display text-lg font-bold">
                        {exam.title}
                      </h3>
                      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                        {formatExamScheduleIST(exam.starts_at)} · {exam.duration_min} min
                      </p>
                    </div>
                    <Button asChild size="sm" variant={isLive || lobbyOpen ? "primary" : "outline"}>
                      <Link href={href}>
                        {cta} <ArrowRight className="size-3.5" aria-hidden />
                      </Link>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-12">
        <Heading as="h2" size="h4">
          Past
        </Heading>
        {past.length === 0 ? (
          <EmptyState
            className="mt-4"
            icon={History}
            title="No past exams"
            description="After you complete a live mock, your scorecard and merit links appear here."
          />
        ) : (
          <ul className="mt-4 space-y-3">
            {past.map(({ exam }) => {
              const attempt = attemptByExam.get(exam.id);
              const href = attempt
                ? `/exams/${exam.slug}/result`
                : `/exams/${exam.slug}`;
              return (
                <li
                  key={exam.id}
                  className={cn(
                    "rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                        {attempt
                          ? attemptStatusLabel(attempt.status)
                          : "Not attempted"}
                      </p>
                      <h3 className="mt-1 font-display text-lg font-bold">
                        {exam.title}
                      </h3>
                      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                        {formatExamScheduleIST(exam.starts_at)}
                      </p>
                    </div>
                    {attempt && (
                      <Button asChild size="sm" variant="outline">
                        <Link href={href}>
                          View scorecard <ArrowRight className="size-3.5" aria-hidden />
                        </Link>
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
