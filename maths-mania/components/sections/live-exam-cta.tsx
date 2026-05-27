import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { CountdownTimer } from "@/components/exam/countdown-timer";
import { LAST_EXAM_STATS, NEXT_LIVE_EXAM } from "@/lib/home-data";
import { formatIndianNumber } from "@/lib/utils";
import { ArrowRight } from "lucide-react";

export function LiveExamCtaSection() {
  return (
    <Section
      padding="lg"
      tone="dark"
      className="relative overflow-hidden bg-chalk !bg-[var(--color-primary-700)] text-white [--color-text:oklch(98%_0.005_60)] [--color-text-muted:oklch(92%_0.02_25)]"
    >
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[var(--color-primary-600)] via-[var(--color-primary-700)] to-[var(--color-primary-900)]"
        aria-hidden
      />
      <Container className="relative grid gap-10 lg:grid-cols-2 lg:items-center">
        <div>
          <Heading as="h2" size="h1" className="text-white">
            Sunday, 11 AM IST.
            <br />
            The whole country writes the same test.
          </Heading>
          <p className="mt-5 max-w-lg text-lg text-white/85">
            Free 30-minute live mock. Synchronized start. All-India merit list
            published within 60 minutes of close.
          </p>
          <p className="mt-6 text-sm text-white/70">
            Last exam: {formatIndianNumber(LAST_EXAM_STATS.attempts)} attempts ·
            Topper: {LAST_EXAM_STATS.topperName}, {LAST_EXAM_STATS.topperScore}% ·{" "}
            <Link
              href={`/exams/${LAST_EXAM_STATS.meritSlug}/merit`}
              className="font-semibold text-white underline-offset-2 hover:underline"
            >
              See merit list →
            </Link>
          </p>
        </div>

        <div className="flex flex-col items-center gap-6 rounded-[var(--radius-xl)] border border-white/15 bg-white/10 p-8 backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/80">
            Starts in
          </p>
          <CountdownTimer
            targetIso={NEXT_LIVE_EXAM.startsAt}
            size="lg"
            className="!text-white"
          />
          <Button
            asChild
            size="xl"
            className="w-full max-w-xs bg-white text-[var(--color-primary-700)] shadow-lg hover:bg-white/95"
          >
            <Link href={`/exams/${NEXT_LIVE_EXAM.slug}`}>
              Reserve my seat
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </div>
      </Container>
    </Section>
  );
}
