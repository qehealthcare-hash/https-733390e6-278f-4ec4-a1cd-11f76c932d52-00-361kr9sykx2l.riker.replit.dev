import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { ExamCard } from "@/components/exam/exam-card";
import { listPublicExams } from "@/lib/exams/public";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Live Exams — Free All-India Mock Tests",
  description:
    "Free synchronized live mock exams. Auto-graded scorecard, All-India merit list, downloadable certificate for top performers.",
};

const TABS = [
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past results" },
  { id: "merit", label: "Merit lists" },
] as const;

type TabId = (typeof TABS)[number]["id"];

type Props = {
  searchParams: Promise<{ tab?: string }>;
};

function parseTab(value: string | undefined): TabId {
  if (value === "past" || value === "merit") return value;
  return "upcoming";
}

export default async function ExamsHubPage({ searchParams }: Props) {
  const { tab: rawTab } = await searchParams;
  const tab = parseTab(rawTab);
  const exams = await listPublicExams(tab);

  return (
    <>
      <Section padding="lg" tone="default" className="border-b border-[var(--color-border)]">
        <Container>
          <Eyebrow tone="accent">Live exams</Eyebrow>
          <Heading as="h1" size="h1" className="mt-3 max-w-3xl">
            Free All-India synchronized mocks
          </Heading>
          <p className="mt-4 max-w-2xl text-lg text-[var(--color-text-muted)]">
            Everyone starts together. Auto-graded in minutes, ranked nationally,
            with certificates for top performers. Register once — we will remind
            you before the lobby opens.
          </p>
        </Container>
      </Section>

      <Section padding="md" tone="default">
        <Container>
          <nav
            aria-label="Exam listings"
            className="flex flex-wrap gap-2 border-b border-[var(--color-border)] pb-4"
          >
            {TABS.map((t) => (
              <Link
                key={t.id}
                href={t.id === "upcoming" ? "/exams" : `/exams?tab=${t.id}`}
                className={cn(
                  "rounded-full px-4 py-2 text-sm font-semibold transition",
                  tab === t.id
                    ? "bg-[var(--color-primary-600)] text-white"
                    : "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
                )}
                aria-current={tab === t.id ? "page" : undefined}
              >
                {t.label}
              </Link>
            ))}
          </nav>

          {!isSupabaseConfigured() && (
            <p className="mt-8 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-muted)] p-6 text-sm text-[var(--color-text-muted)]">
              Connect Supabase to load scheduled exams. Demo exams ship in local
              migrations — run <code className="font-mono">supabase db reset</code>{" "}
              then set env vars.
            </p>
          )}

          {exams.length === 0 ? (
            <p className="mt-10 text-center text-[var(--color-text-muted)]">
              {tab === "upcoming"
                ? "No upcoming exams scheduled yet. Check back soon."
                : tab === "merit"
                  ? "No published merit lists yet."
                  : "No past exams to show yet."}
            </p>
          ) : (
            <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {exams.map((exam) => (
                <li key={exam.id}>
                  <ExamCard exam={exam} />
                </li>
              ))}
            </ul>
          )}

          {tab === "upcoming" && (
            <p className="mt-10 text-center text-sm text-[var(--color-text-faint)]">
              Lobby, timed attempt, and anti-cheat ship in the next milestone.
            </p>
          )}
        </Container>
      </Section>
    </>
  );
}
