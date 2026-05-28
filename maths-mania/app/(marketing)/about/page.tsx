import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, Radio, Users } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "About — Beyond Numbers",
  description:
    "Our story, our teaching philosophy, and why we built Maths Mania for Indian students.",
};

const STATS = [
  { label: "YouTube learners", value: "1.2L+", icon: Users },
  { label: "Live mocks hosted", value: "40+", icon: Radio },
  { label: "Free PDFs & tricks", value: "25+", icon: BookOpen },
] as const;

export default function AboutPage() {
  return (
    <>
      <Section padding="lg" tone="notebook">
        <Container size="md">
          <Eyebrow tone="primary">About Maths Mania</Eyebrow>
          <Heading as="h1" size="display" className="mt-4">
            Beyond numbers — your way to learn
          </Heading>
          <p className="mt-6 text-lg leading-relaxed text-[var(--color-text-muted)]">
            Maths Mania started in {SITE.city} with a simple frustration: students
            were memorising steps without understanding why a method works. We teach
            the why first, then the speed — so boards, banking, and SSC papers feel
            predictable instead of scary.
          </p>
        </Container>
      </Section>

      <Section padding="md" tone="default">
        <Container>
          <ul className="grid gap-4 sm:grid-cols-3">
            {STATS.map(({ label, value, icon: Icon }) => (
              <li
                key={label}
                className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center shadow-[var(--shadow-soft)]"
              >
                <Icon
                  className="mx-auto size-8 text-[var(--color-primary-600)]"
                  aria-hidden
                />
                <p className="mt-3 font-display text-3xl font-bold text-[var(--color-text)]">
                  {value}
                </p>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                  {label}
                </p>
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      <Section padding="lg" tone="default">
        <Container size="md">
          <Heading as="h2" size="h2">
            How we teach
          </Heading>
          <div className="mt-8 space-y-6 text-sm leading-relaxed text-[var(--color-text-muted)]">
            <p>
              <strong className="text-[var(--color-text)]">Concept → pattern → speed.</strong>{" "}
              Every topic is broken into board- and exam-friendly steps. We show one
              clean solution on the whiteboard, then the shortcut that saves minutes
              when the clock is ticking.
            </p>
            <p>
              <strong className="text-[var(--color-text)]">Practice that counts.</strong>{" "}
              Self-paced quizzes on the site, daily questions on YouTube, and free
              Sunday live mocks with an All-India merit list — so you know where you
              stand before the real hall.
            </p>
            <p>
              <strong className="text-[var(--color-text)]">Built for India.</strong>{" "}
              CBSE and Gujarat Board school tracks, IBPS/SBI banking quant, SSC CGL
              patterns, and Gujarati-English mixed explanations where it helps.
            </p>
          </div>

          <Heading as="h2" size="h3" className="mt-12">
            The Sunday ritual
          </Heading>
          <p className="mt-4 text-sm leading-relaxed text-[var(--color-text-muted)]">
            One synchronized 30-minute mock, same paper for everyone online, auto-graded
            scorecard, merit within an hour, certificates for top 10% after publish.
            No paywall for the exam itself — because rank practice should not be a
            luxury.
          </p>

          <div className="mt-10 flex flex-wrap gap-3">
            <Button asChild variant="primary">
              <Link href="/exams">
                See upcoming live exams
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/videos">Watch on YouTube</Link>
            </Button>
          </div>
        </Container>
      </Section>
    </>
  );
}
