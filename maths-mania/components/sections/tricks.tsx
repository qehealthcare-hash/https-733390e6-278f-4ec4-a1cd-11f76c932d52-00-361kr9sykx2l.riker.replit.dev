import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { LatexBlock } from "@/components/math/latex-block";
import { Card, CardBody } from "@/components/ui/card";
import { TRICKS } from "@/lib/home-data";
import { ArrowRight } from "lucide-react";

export function TricksSection() {
  return (
    <Section padding="lg" tone="default">
      <Container>
        <div className="max-w-2xl">
          <Eyebrow tone="accent">Smart tricks</Eyebrow>
          <Heading as="h2" size="h2" className="mt-3">
            Smart tricks of the week
          </Heading>
          <p className="mt-3 text-[var(--color-text-muted)]">
            Methods that actually work in the exam hall — not just for reels.
          </p>
        </div>

        <ul className="mt-10 grid gap-6 md:grid-cols-3">
          {TRICKS.map((trick) => (
            <li key={trick.id}>
              <Card className="h-full hover:-translate-y-0.5">
                <CardBody>
                  <h3 className="font-semibold text-[var(--color-text)]">
                    {trick.title}
                  </h3>
                  <div className="mt-4 rounded-[var(--radius-md)] bg-[var(--color-surface-alt)] px-3 py-4">
                    <LatexBlock math={trick.latex} display />
                  </div>
                  <p className="mt-3 text-sm text-[var(--color-text-muted)]">
                    {trick.explanation}
                  </p>
                  <p className="mt-2 font-mono text-xs text-[var(--color-text-faint)]">
                    e.g. {trick.example}
                  </p>
                  <Link
                    href={trick.href}
                    className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-primary-600)]"
                  >
                    Read full trick
                    <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>

        <p className="mt-8 text-center">
          <Link
            href="/blog?tag=tricks"
            className="text-sm font-semibold text-[var(--color-primary-600)] hover:underline"
          >
            See all tricks →
          </Link>
        </p>
      </Container>
    </Section>
  );
}
