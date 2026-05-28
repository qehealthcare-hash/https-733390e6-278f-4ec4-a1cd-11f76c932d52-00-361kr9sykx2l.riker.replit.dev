import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { TestimonialCard } from "@/components/sections/testimonial-card";
import { getTestimonials } from "@/lib/content";

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
