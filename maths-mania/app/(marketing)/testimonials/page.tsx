import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { TestimonialCard } from "@/components/sections/testimonial-card";
import { getTestimonials } from "@/lib/content";

export const metadata: Metadata = {
  title: "Testimonials — Student stories",
  description:
    "Real results from school students, banking aspirants, and SSC candidates who learned with Maths Mania live mocks and YouTube lessons.",
};

export default function TestimonialsPage() {
  const testimonials = getTestimonials();

  return (
    <>
      <Section padding="lg" tone="notebook">
        <Container>
          <Eyebrow tone="muted">Social proof</Eyebrow>
          <Heading as="h1" size="display" className="mt-4 max-w-3xl">
            Students who made maths click
          </Heading>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[var(--color-text-muted)]">
            Gujarat and beyond — school boards, IBPS, SSC, and Sunday live mocks.
            These are edited summaries from learners and merit-list rankers.
          </p>
        </Container>
      </Section>

      <Section padding="lg" tone="default">
        <Container>
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {testimonials.map((t) => (
              <li key={t.id}>
                <TestimonialCard {...t} />
              </li>
            ))}
          </ul>
        </Container>
      </Section>
    </>
  );
}
