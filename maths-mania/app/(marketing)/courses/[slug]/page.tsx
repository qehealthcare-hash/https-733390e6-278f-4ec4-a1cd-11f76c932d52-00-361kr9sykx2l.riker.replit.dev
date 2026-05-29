import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, FileText, ListOrdered } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { PillarIcon } from "@/components/illustrations/pillar-icon";
import { SyllabusAccordion } from "@/components/sections/syllabus-accordion";
import { PlaylistEmbed } from "@/components/sections/playlist-embed";
import { FaqAccordion } from "@/components/sections/faq-accordion";
import {
  ACCENT_STYLES,
  getAllCourseSlugs,
  getCourse,
  getPillarFromSite,
} from "@/lib/courses";
import type { PillarSlug } from "@/lib/site";
import { cn } from "@/lib/utils";
import { Breadcrumbs } from "@/components/seo/breadcrumbs";
import { JsonLd } from "@/components/seo/json-ld";
import { courseSchema, createPageMetadata } from "@/lib/seo";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return getAllCourseSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const course = getCourse(slug);
  if (!course) return { title: "Course" };
  return createPageMetadata({
    title: course.metaTitle,
    description: course.metaDescription,
    path: `/courses/${slug}`,
  });
}

export default async function CourseDetailPage({ params }: Props) {
  const { slug } = await params;
  const course = getCourse(slug);
  if (!course) notFound();

  const pillar = getPillarFromSite(course.slug as PillarSlug);
  const accent = ACCENT_STYLES[course.slug as PillarSlug];
  const isExams = course.slug === "exams";

  return (
    <>
      <JsonLd
        data={courseSchema({
          name: course.heroTitle,
          description: course.metaDescription,
          path: `/courses/${course.slug}`,
        })}
      />
      <Section
        padding="lg"
        tone="default"
        className={cn(
          "border-b border-[var(--color-border)] bg-gradient-to-br",
          accent.bg,
        )}
      >
        <Container>
          <Breadcrumbs
            className="mb-6"
            items={[
              { name: "Home", href: "/" },
              { name: "Courses", href: "/courses" },
              { name: pillar?.label ?? course.heroTitle },
            ]}
          />
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <div className="flex items-center gap-4">
                <span
                  className={cn(
                    "inline-flex size-14 items-center justify-center rounded-[var(--radius-lg)] border bg-[var(--color-surface)] shadow-[var(--shadow-soft)]",
                    accent.border,
                    accent.text,
                  )}
                >
                  <PillarIcon slug={course.slug as PillarSlug} className="size-8" />
                </span>
                <Eyebrow tone="muted">{course.heroEyebrow}</Eyebrow>
              </div>
              <Heading as="h1" size="h1" className="mt-6">
                {course.heroTitle}
              </Heading>
              <p className="mt-4 text-lg leading-relaxed text-[var(--color-text-muted)]">
                {course.heroSubtitle}
              </p>
              <p className="mt-2 font-mono text-xs text-[var(--color-text-faint)]">
                {course.stat}
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild size="lg" variant="primary">
                  <Link href={course.primaryCta.href}>
                    {course.primaryCta.label}
                    <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </Button>
                {course.secondaryCta && (
                  <Button asChild size="lg" variant="outline">
                    <Link href={course.secondaryCta.href}>
                      {course.secondaryCta.label}
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Container>
      </Section>

      <Section padding="lg" tone="default">
        <Container size="lg">
          <div className="flex items-center gap-2">
            <ListOrdered className="size-5 text-[var(--color-primary-500)]" aria-hidden />
            <Heading as="h2" size="h2">
              {isExams ? "Exam calendar & rules" : "Syllabus"}
            </Heading>
          </div>
          <p className="mt-2 text-[var(--color-text-muted)]">
            {isExams
              ? "What to expect from each live mock and how ranking works."
              : "Chapters and topics covered in this track, in the order we recommend."}
          </p>
          <div className="mt-8">
            <SyllabusAccordion chapters={course.syllabus} />
          </div>
        </Container>
      </Section>

      {!isExams && course.playlistEnvKey && (
        <Section padding="lg" tone="alt">
          <Container size="lg">
            <Eyebrow tone="secondary">YouTube playlist</Eyebrow>
            <Heading as="h2" size="h2" className="mt-3">
              Watch in order
            </Heading>
            <p className="mt-2 text-[var(--color-text-muted)]">
              Full playlist for this track — free on YouTube.
            </p>
            <div className="mt-8">
              <PlaylistEmbed
                playlistEnvKey={course.playlistEnvKey}
                title={`${pillar.label} playlist`}
              />
            </div>
          </Container>
        </Section>
      )}

      {isExams && (
        <Section padding="lg" tone="alt">
          <Container size="lg" className="text-center">
            <Heading as="h2" size="h2">
              Upcoming live exams
            </Heading>
            <p className="mx-auto mt-3 max-w-lg text-[var(--color-text-muted)]">
              Register for the next Sunday mock or browse past results and merit
              lists.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button asChild size="lg" variant="primary">
                <Link href="/exams">Upcoming exams</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/exams?tab=past">Past results</Link>
              </Button>
            </div>
          </Container>
        </Section>
      )}

      {course.recommendedVideos.length > 0 && (
        <Section padding="lg" tone="default">
          <Container size="lg">
            <Heading as="h2" size="h2">
              Recommended watch order
            </Heading>
            <p className="mt-2 text-[var(--color-text-muted)]">
              Start from the top if you&apos;re new to this track.
            </p>
            <ol className="mt-8 space-y-4">
              {course.recommendedVideos.map((video) => (
                <li
                  key={video.order}
                  className="flex gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-soft)]"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-500)] font-mono text-sm font-bold text-white">
                    {video.order}
                  </span>
                  <div>
                    <p className="font-semibold text-[var(--color-text)]">
                      {video.title}
                    </p>
                    <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                      {video.note}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-6">
              <Link
                href="/videos"
                className="text-sm font-semibold text-[var(--color-primary-600)] hover:underline"
              >
                Browse all videos →
              </Link>
            </p>
          </Container>
        </Section>
      )}

      {course.downloads.length > 0 && (
        <Section padding="lg" tone="alt">
          <Container size="lg">
            <Heading as="h2" size="h2">
              Downloads for this track
            </Heading>
            <ul className="mt-8 grid gap-4 sm:grid-cols-2">
              {course.downloads.map((dl) => (
                <li key={dl.id}>
                  <Link
                    href={dl.href}
                    className="flex gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-shadow hover:shadow-[var(--shadow-card)]"
                  >
                    <FileText
                      className="size-8 shrink-0 text-[var(--color-primary-500)]"
                      aria-hidden
                    />
                    <span>
                      <span className="block font-semibold text-[var(--color-text)]">
                        {dl.title}
                      </span>
                      <span className="mt-1 block text-sm text-[var(--color-text-muted)]">
                        {dl.description}
                      </span>
                      {dl.pages && (
                        <span className="mt-1 block font-mono text-xs text-[var(--color-text-faint)]">
                          {dl.pages} pages · Free
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Container>
        </Section>
      )}

      <Section padding="lg" tone="default">
        <Container size="md">
          <Heading as="h2" size="h2">
            {pillar.shortLabel} — common questions
          </Heading>
          <div className="mt-8">
            <FaqAccordion items={course.faqs} />
          </div>
        </Container>
      </Section>

      <Section padding="md" tone="alt">
        <Container className="flex flex-col items-center gap-4 text-center sm:flex-row sm:justify-center">
          <Button asChild variant="primary" size="lg">
            <Link href={course.primaryCta.href}>{course.primaryCta.label}</Link>
          </Button>
          <Button asChild variant="ghost" size="lg">
            <Link href="/courses">← All tracks</Link>
          </Button>
        </Container>
      </Section>
    </>
  );
}
