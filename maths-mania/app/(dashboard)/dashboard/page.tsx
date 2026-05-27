import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { requireAuth } from "@/lib/auth/guard";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your Maths Mania home — upcoming live exams, recent attempts, and quick links.",
};

export default async function DashboardPage() {
  const { profile } = await requireAuth({ requireOnboarded: true });

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
        . Live exam registration and attempt history land in milestone 12–15.
      </p>

      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          <h2 className="font-display text-lg font-bold">Live exams</h2>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Register for the next All-India mock — free, timed, ranked.
          </p>
          <Button variant="primary" size="md" className="mt-4" asChild>
            <Link href="/exams">
              Browse exams
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </div>
        <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          <h2 className="font-display text-lg font-bold">Practice</h2>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Self-paced quizzes — no timer, instant explanations.
          </p>
          <Button variant="outline" size="md" className="mt-4" asChild>
            <Link href="/quiz">Take a quiz</Link>
          </Button>
        </div>
      </div>
    </>
  );
}
