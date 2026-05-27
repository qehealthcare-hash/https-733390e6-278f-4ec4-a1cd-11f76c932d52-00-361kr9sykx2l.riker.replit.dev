import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { PillarCard } from "@/components/sections/pillar-card";
import { SITE } from "@/lib/site";
import { COURSE_COMPARISON, getCourse } from "@/lib/courses";
import { ArrowRight } from "lucide-react";

export const metadata: Metadata = {
  title: "Courses — Five tracks. One method.",
  description:
    "School maths, banking quant, SSC aptitude, smart tricks, and live All-India exams. Learn the concepts, practice the tricks, then prove it on a ranked mock.",
};

export default function CoursesPage() {
  return (
    <>
      <Section padding="lg" tone="notebook">
        <Container>
          <Eyebrow tone="primary">What we teach</Eyebrow>
          <Heading as="h1" size="display" className="mt-4 max-w-3xl">
            Five tracks. One method.
          </Heading>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[var(--color-text-muted)]">
            Learn the concepts. Practice the tricks. Then prove it on a live
            All-India exam. Pick your track below — every path leads to the same
            goal: maths that finally makes sense.
          </p>
          <Button asChild size="lg" variant="primary" className="mt-8">
            <Link href="/exams">
              Register for Sunday&apos;s live mock
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </Container>
      </Section>

      <Section padding="lg" tone="default">
        <Container>
          <Heading as="h2" size="h2">
            Pick your track
          </Heading>
          <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {SITE.pillars.map((pillar) => {
              const course = getCourse(pillar.slug);
              return (
                <li
                  key={pillar.slug}
                  className={pillar.slug === "exams" ? "sm:col-span-2 lg:col-span-1" : ""}
                >
                  <PillarCard
                    pillar={pillar}
                    stat={course?.stat ?? "4,200+ students"}
                  />
                </li>
              );
            })}
          </ul>
        </Container>
      </Section>

      <Section padding="lg" tone="alt">
        <Container>
          <Heading as="h2" size="h2">
            Compare tracks
          </Heading>
          <p className="mt-3 text-[var(--color-text-muted)]">
            Not sure where to start? Use this table — then dive into the track
            page for syllabus and playlists.
          </p>

          <div className="mt-8 overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-soft)]">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
                  <th className="px-4 py-3 font-semibold text-[var(--color-text-muted)]">
                    Feature
                  </th>
                  <th className="px-4 py-3 font-semibold">School</th>
                  <th className="px-4 py-3 font-semibold">Banking</th>
                  <th className="px-4 py-3 font-semibold">SSC</th>
                  <th className="px-4 py-3 font-semibold">Tricks</th>
                  <th className="px-4 py-3 font-semibold text-[var(--color-primary-600)]">
                    Live exams
                  </th>
                </tr>
              </thead>
              <tbody>
                {COURSE_COMPARISON.map((row) => (
                  <tr
                    key={row.feature}
                    className="border-b border-[var(--color-border)] last:border-0"
                  >
                    <td className="px-4 py-3 font-medium text-[var(--color-text)]">
                      {row.feature}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">
                      {row.school}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">
                      {row.banking}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">
                      {row.ssc}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">
                      {row.tricks}
                    </td>
                    <td className="px-4 py-3 font-medium text-[var(--color-primary-600)]">
                      {row.exams}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-6 text-sm text-[var(--color-text-muted)]">
            Live exams are the only track with a synchronized All-India start and
            published merit list — but every other track feeds into them.
          </p>
        </Container>
      </Section>

      <Section padding="md" tone="default">
        <Container className="text-center">
          <p className="font-display text-xl font-bold text-[var(--color-text)]">
            Ready to prove it?
          </p>
          <Button asChild variant="primary" size="lg" className="mt-4">
            <Link href="/exams">View upcoming live exams</Link>
          </Button>
        </Container>
      </Section>
    </>
  );
}
