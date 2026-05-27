import Link from "next/link";
import { Star } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { getTestimonials } from "@/lib/content";

function TestimonialCard({
  name,
  initials,
  context,
  quote,
  rating,
  meritRank,
}: {
  name: string;
  initials: string;
  context: string;
  quote: string;
  rating: number;
  meritRank?: string;
}) {
  return (
    <blockquote className="flex h-full flex-col rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-soft)]">
      <div className="flex items-center gap-3">
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-100)] font-semibold text-[var(--color-primary-700)] dark:bg-[var(--color-primary-900)]/40 dark:text-[var(--color-primary-200)]"
          aria-hidden
        >
          {initials}
        </span>
        <div>
          <cite className="not-italic font-semibold text-[var(--color-text)]">
            {name}
          </cite>
          <p className="text-xs text-[var(--color-text-muted)]">{context}</p>
        </div>
      </div>
      <div className="mt-3 flex gap-0.5" aria-label={`${rating} out of 5 stars`}>
        {Array.from({ length: rating }).map((_, i) => (
          <Star
            key={i}
            className="size-3.5 fill-[var(--color-accent-500)] text-[var(--color-accent-500)]"
            aria-hidden
          />
        ))}
      </div>
      <p className="mt-4 flex-1 text-sm leading-relaxed text-[var(--color-text-muted)]">
        &ldquo;{quote}&rdquo;
      </p>
      {meritRank && (
        <p className="mt-3 text-xs font-semibold text-[var(--color-primary-600)]">
          {meritRank}
        </p>
      )}
    </blockquote>
  );
}

export function TestimonialsSection() {
  const testimonials = getTestimonials().slice(0, 6);

  return (
    <Section padding="lg" tone="default">
      <Container>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Eyebrow tone="muted">Social proof</Eyebrow>
            <Heading as="h2" size="h2" className="mt-3">
              From our students
            </Heading>
          </div>
          <Link
            href="/testimonials"
            className="text-sm font-semibold text-[var(--color-primary-600)]"
          >
            All stories →
          </Link>
        </div>

        <ul className="mt-10 flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory md:grid md:grid-cols-2 md:overflow-visible lg:grid-cols-3 md:pb-0">
          {testimonials.map((t) => (
            <li
              key={t.id}
              className="min-w-[min(100%,320px)] shrink-0 snap-start md:min-w-0"
            >
              <TestimonialCard {...t} />
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  );
}
