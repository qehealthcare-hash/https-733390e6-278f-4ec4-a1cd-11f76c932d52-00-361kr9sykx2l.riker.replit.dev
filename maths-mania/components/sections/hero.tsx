import Link from "next/link";
import { ArrowRight, GraduationCap } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { HeroNotebook } from "@/components/illustrations/hero-notebook";
import { Stat } from "@/components/ui/stat";
import { HeroExamOverlay } from "@/components/sections/hero-exam-overlay";
import { SITE } from "@/lib/site";
import { NEXT_LIVE_EXAM, TRUST_CHIPS } from "@/lib/home-data";
import { formatIndianNumber } from "@/lib/utils";
import { FadeIn } from "@/components/ui/fade-in";

export function HeroSection() {
  return (
    <Section padding="lg" tone="notebook" className="overflow-hidden">
      <Container className="grid gap-12 lg:grid-cols-12 lg:items-center">
        <FadeIn className="lg:col-span-6">
          <Eyebrow tone="primary">
            <GraduationCap className="size-3.5" aria-hidden />
            Trusted by school + competitive aspirants
          </Eyebrow>

          <Heading as="h1" size="display" className="mt-5">
            Maths, finally,{" "}
            <span className="text-[var(--color-primary-500)]">makes sense.</span>
          </Heading>

          <p className="mt-6 max-w-xl text-lg leading-relaxed text-[var(--color-text-muted)]">
            From Class 1 fundamentals to SSC and Banking aptitude — step-by-step
            methods, smart shortcuts, and real-time mock exams with an All-India
            merit list. Free on YouTube, free to attempt.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button asChild size="lg" variant="primary">
              <Link href={`/exams/${NEXT_LIVE_EXAM.slug}`}>
                Register for Sunday&apos;s exam
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a
                href={SITE.social.youtube}
                target="_blank"
                rel="noopener noreferrer"
              >
                Subscribe on YouTube ▶
              </a>
            </Button>
            <Button asChild size="lg" variant="ghost" className="sm:max-md:hidden">
              <Link href="/courses">Browse free lessons →</Link>
            </Button>
          </div>
          <p className="mt-3 md:hidden">
            <Link
              href="/courses"
              className="text-sm font-semibold text-[var(--color-primary-600)]"
            >
              Browse free lessons →
            </Link>
          </p>

          <dl className="mt-12 grid max-w-lg grid-cols-3 gap-6 border-t border-[var(--color-border)] pt-8">
            <Stat label="Live exam" value="Sun 11 AM" />
            <Stat
              label="Registered"
              value={formatIndianNumber(NEXT_LIVE_EXAM.registeredCount)}
            />
            <Stat label="Duration" value={`${NEXT_LIVE_EXAM.durationMin} min`} />
          </dl>

          <ul className="mt-8 flex flex-wrap gap-2" aria-label="Exam boards covered">
            {TRUST_CHIPS.map((chip) => (
              <li
                key={chip}
                className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/80 px-3 py-1 text-xs font-medium text-[var(--color-text-muted)]"
              >
                {chip}
              </li>
            ))}
          </ul>
        </FadeIn>

        <FadeIn className="relative lg:col-span-6" delay={0.08}>
          <div
            className="pointer-events-none absolute -right-8 top-1/2 size-72 -translate-y-1/2 rounded-full opacity-30 blur-3xl"
            style={{
              background:
                "radial-gradient(circle, oklch(80% 0.2 95) 0%, oklch(62% 0.21 25) 50%, transparent 70%)",
            }}
            aria-hidden
          />
          <div className="relative mx-auto max-w-md animate-[float_6s_ease-in-out_infinite] motion-reduce:animate-none">
            <HeroNotebook />
            <HeroExamOverlay
              examTitle={NEXT_LIVE_EXAM.title}
              startsAt={NEXT_LIVE_EXAM.startsAt}
              registeredCount={NEXT_LIVE_EXAM.registeredCount}
              slug={NEXT_LIVE_EXAM.slug}
            />
          </div>
        </FadeIn>
      </Container>
    </Section>
  );
}
