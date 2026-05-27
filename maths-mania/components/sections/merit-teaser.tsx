import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { MERIT_TOP_10 } from "@/lib/home-data";
import { cn } from "@/lib/utils";

function rankAccent(rank: number): string {
  if (rank === 1) return "text-amber-600 dark:text-amber-400";
  if (rank === 2) return "text-neutral-500 dark:text-neutral-400";
  if (rank === 3) return "text-amber-800 dark:text-amber-600";
  return "text-[var(--color-text-muted)]";
}

export function MeritTeaserSection() {
  return (
    <Section padding="lg" tone="default">
      <Container>
        <div className="max-w-2xl">
          <Eyebrow tone="primary">Live leaderboard</Eyebrow>
          <Heading as="h2" size="h2" className="mt-3">
            This week&apos;s All-India toppers
          </Heading>
          <p className="mt-3 text-[var(--color-text-muted)]">
            Published within an hour of exam close. Names shown as first name +
            last initial for privacy.
          </p>
        </div>

        <div className="mt-8 overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-soft)]">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
                <th className="px-4 py-3 font-semibold text-[var(--color-text-muted)]">
                  Rank
                </th>
                <th className="px-4 py-3 font-semibold text-[var(--color-text-muted)]">
                  Name
                </th>
                <th className="px-4 py-3 font-semibold text-[var(--color-text-muted)]">
                  City
                </th>
                <th className="px-4 py-3 font-semibold text-[var(--color-text-muted)]">
                  Score
                </th>
                <th className="px-4 py-3 font-semibold text-[var(--color-text-muted)]">
                  Percentile
                </th>
              </tr>
            </thead>
            <tbody>
              {MERIT_TOP_10.map((row) => (
                <tr
                  key={row.rank}
                  className="border-b border-[var(--color-border)] last:border-0"
                >
                  <td
                    className={cn(
                      "px-4 py-3 font-mono font-bold tabular-nums",
                      rankAccent(row.rank),
                    )}
                  >
                    #{row.rank}
                  </td>
                  <td className="px-4 py-3 font-medium text-[var(--color-text)]">
                    {row.name}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-text-muted)]">
                    {row.city}
                  </td>
                  <td className="px-4 py-3 font-mono tabular-nums">
                    {row.score}%
                  </td>
                  <td className="px-4 py-3 font-mono tabular-nums text-[var(--color-text-muted)]">
                    {row.percentile}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-8 text-center">
          <p className="text-[var(--color-text-muted)]">
            Want your name here?
          </p>
          <Button asChild variant="primary" className="mt-4">
            <Link href="/exams">Register for the next exam</Link>
          </Button>
        </div>
      </Container>
    </Section>
  );
}
