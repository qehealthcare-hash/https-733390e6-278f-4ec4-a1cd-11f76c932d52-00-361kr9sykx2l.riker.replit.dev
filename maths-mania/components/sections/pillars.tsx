import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { PillarCard } from "@/components/sections/pillar-card";
import { PillarIcon } from "@/components/illustrations/pillar-icon";
import { CountdownTimer } from "@/components/exam/countdown-timer";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { SITE } from "@/lib/site";
import { NEXT_LIVE_EXAM } from "@/lib/home-data";
import { formatIndianNumber } from "@/lib/utils";

export function PillarsSection() {
  const flagship = SITE.pillars.find((p) => p.slug === "exams")!;
  const others = SITE.pillars.filter((p) => p.slug !== "exams");

  return (
    <Section padding="lg" tone="default" id="courses">
      <Container>
        <div className="max-w-2xl">
          <Eyebrow tone="muted">What we teach</Eyebrow>
          <Heading as="h2" size="h1" className="mt-4">
            Choose your track
          </Heading>
          <p className="mt-4 text-lg text-[var(--color-text-muted)]">
            Five pillars — one teaching style. Start where you are; prove it on a
            live All-India exam when you&apos;re ready.
          </p>
        </div>

        <div className="mt-12 grid gap-4 lg:grid-cols-5 lg:gap-5">
          <article className="flex flex-col justify-between overflow-hidden rounded-[var(--radius-xl)] border-2 border-[var(--color-primary-200)] bg-gradient-to-br from-[var(--color-primary-50)] to-[var(--color-surface)] p-6 shadow-[var(--shadow-pop)] lg:col-span-3 dark:from-[var(--color-primary-900)]/25">
            <div>
              <div className="inline-flex size-12 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary-500)] text-white">
                <PillarIcon slug="exams" className="size-8 text-white" />
              </div>
              <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-[var(--color-primary-600)]">
                {flagship.tag}
              </p>
              <h3 className="mt-2 font-display text-2xl font-bold text-[var(--color-text)]">
                {flagship.label}
              </h3>
              <p className="mt-3 max-w-lg text-sm leading-relaxed text-[var(--color-text-muted)]">
                {flagship.blurb}
              </p>
              <p className="mt-3 font-mono text-xs text-[var(--color-text-faint)]">
                {formatIndianNumber(NEXT_LIVE_EXAM.registeredCount)} students
                registered this week
              </p>
            </div>
            <div className="mt-6 flex flex-wrap items-end justify-between gap-4 border-t border-[var(--color-border)] pt-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                  Next exam in
                </p>
                <CountdownTimer
                  targetIso={NEXT_LIVE_EXAM.startsAt}
                  className="text-[var(--color-primary-600)]"
                />
              </div>
              <Button asChild variant="primary" size="lg">
                <Link href="/exams">
                  Register free
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
            </div>
          </article>

          <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-1 xl:grid-cols-2">
            {others.map((pillar) => (
              <PillarCard key={pillar.slug} pillar={pillar} />
            ))}
          </div>
        </div>
      </Container>
    </Section>
  );
}
