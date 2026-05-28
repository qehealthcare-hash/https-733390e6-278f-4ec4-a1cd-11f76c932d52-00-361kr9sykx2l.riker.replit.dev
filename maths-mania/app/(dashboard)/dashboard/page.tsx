import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Award, ClipboardList, Play, Trophy } from "lucide-react";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/dashboard/stat-card";
import { UpcomingExamCard } from "@/components/dashboard/upcoming-exam-card";
import { AttemptRow } from "@/components/dashboard/attempt-row";
import { requireAuth } from "@/lib/auth/guard";
import { getDashboardOverview } from "@/lib/dashboard";
import { getLatestVideos } from "@/lib/youtube";
import { getFeaturedUpcomingExam } from "@/lib/exams/public";

export const metadata: Metadata = {
  title: "Dashboard",
  description:
    "Your Maths Mania home — upcoming live exams, recent attempts, and quick links.",
};

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { profile, user } = await requireAuth({ requireOnboarded: true });
  const [overview, videos, featuredExam] = await Promise.all([
    getDashboardOverview(user.id),
    getLatestVideos(3),
    getFeaturedUpcomingExam(),
  ]);

  const hasUpcoming = overview.upcoming.length > 0;

  return (
    <>
      <Heading as="h1" size="h2">
        Hi, {profile.display_name}
      </Heading>
      <p className="mt-2 text-[var(--color-text-muted)]">
        Preparing for{" "}
        <span className="font-medium text-[var(--color-text)]">
          {profile.class_or_target?.replace(/-/g, " ") ?? "your goal"}
        </span>
        .
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Registered"
          value={overview.stats.exams_registered}
          icon={ClipboardList}
        />
        <StatCard
          label="Attempts"
          value={overview.stats.attempts_completed}
          icon={Trophy}
        />
        <StatCard
          label="Certificates"
          value={overview.stats.certificates}
          icon={Award}
        />
        <StatCard
          label="Best percentile"
          value={
            overview.stats.best_percentile != null
              ? `${Number(overview.stats.best_percentile).toFixed(1)}`
              : "—"
          }
          icon={Trophy}
        />
      </div>

      <section className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Heading as="h2" size="h4">
            Upcoming exams
          </Heading>
          <Button asChild variant="link" size="sm" className="h-auto p-0">
            <Link href="/dashboard/exams">View all</Link>
          </Button>
        </div>
        {hasUpcoming ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {overview.upcoming.map(({ exam, attempt }) => (
              <UpcomingExamCard key={exam.id} exam={exam} attempt={attempt} />
            ))}
          </div>
        ) : featuredExam ? (
          <div className="mt-4 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-muted)] p-6">
            <p className="font-medium text-[var(--color-text)]">
              {featuredExam.title}
            </p>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Next All-India mock on the calendar — reserve your seat.
            </p>
            <Button asChild className="mt-4" variant="primary" size="sm">
              <Link href={`/exams/${featuredExam.slug}`}>Register free</Link>
            </Button>
          </div>
        ) : (
          <p className="mt-4 text-sm text-[var(--color-text-muted)]">
            No registrations yet.{" "}
            <Link
              href="/exams"
              className="font-semibold text-[var(--color-primary-600)]"
            >
              Browse exams
            </Link>
            .
          </p>
        )}
      </section>

      {overview.recent_attempts.length > 0 && (
        <section className="mt-10">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <Heading as="h2" size="h4">
              Recent attempts
            </Heading>
            <Button asChild variant="link" size="sm" className="h-auto p-0">
              <Link href="/dashboard/exams">All attempts</Link>
            </Button>
          </div>
          <ul className="mt-4 space-y-3">
            {overview.recent_attempts.map((attempt) => (
              <li key={attempt.id}>
                <AttemptRow attempt={attempt} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Heading as="h2" size="h4">
            Suggested videos
          </Heading>
          <Button asChild variant="link" size="sm" className="h-auto p-0">
            <Link href="/videos">All videos</Link>
          </Button>
        </div>
        <ul className="mt-4 grid gap-4 sm:grid-cols-3">
          {videos.videos.map((video) => (
            <li key={video.id}>
              <a
                href={`https://www.youtube.com/watch?v=${video.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="group block overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] transition hover:border-[var(--color-primary-300)]"
              >
                <div className="relative aspect-video bg-[var(--color-surface-alt)]">
                  <Image
                    src={video.thumbnail}
                    alt=""
                    fill
                    className="object-cover"
                    sizes="(max-width: 640px) 100vw, 240px"
                    loading="lazy"
                  />
                  <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white">
                    {video.duration}
                  </span>
                </div>
                <p className="line-clamp-2 p-3 text-sm font-medium text-[var(--color-text)] group-hover:text-[var(--color-primary-600)]">
                  {video.title}
                </p>
              </a>
            </li>
          ))}
        </ul>
        {videos.source === "placeholder" && (
          <p className="mt-2 text-xs text-[var(--color-text-faint)]">
            Add <code className="font-mono">YOUTUBE_API_KEY</code> for live
            suggestions.
          </p>
        )}
      </section>

      <div className="mt-10 flex flex-wrap gap-3">
        <Button asChild variant="outline" size="md">
          <Link href="/quiz">
            <Play className="size-4" aria-hidden />
            Practice quiz
          </Link>
        </Button>
        <Button asChild variant="outline" size="md">
          <Link href="/exams">Browse exams</Link>
        </Button>
      </div>
    </>
  );
}
