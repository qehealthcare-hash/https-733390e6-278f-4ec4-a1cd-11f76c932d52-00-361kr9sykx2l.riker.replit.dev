import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";

type ComingSoonProps = {
  /** Eyebrow text — e.g. "Milestone 7". */
  milestone: string;
  /** Page title (Fraunces). */
  title: string;
  /** Subhead — what the page will do once shipped. */
  subhead: string;
  /** Optional list of features that will live here. */
  features?: readonly string[];
  /** Primary CTA — defaults to "Back to home". */
  cta?: { label: string; href: string };
};

/**
 * ComingSoon — graceful placeholder for a not-yet-built page.
 *
 * Renders a real, on-brand page (not a 404) so that:
 * - Every navbar/footer link resolves with HTTP 200
 * - Search engines see a real page with proper metadata
 * - The visitor knows the feature is coming, not broken
 *
 * Each milestone replaces these placeholders with the real page in turn.
 */
export function ComingSoon({
  milestone,
  title,
  subhead,
  features,
  cta = { label: "Back to home", href: "/" },
}: ComingSoonProps) {
  return (
    <Section padding="lg" tone="default">
      <Container size="lg">
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow tone="muted">Coming soon · {milestone}</Eyebrow>
          <Heading as="h1" size="h1" className="mt-5">
            {title}
          </Heading>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-[var(--color-text-muted)]">
            {subhead}
          </p>

          {features && features.length > 0 && (
            <ul className="mx-auto mt-10 grid max-w-md gap-3 text-left">
              {features.map((f) => (
                <li
                  key={f}
                  className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text)]"
                >
                  {f}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild variant="primary" size="lg">
              <Link href={cta.href}>
                {cta.label}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="lg">
              <Link href="/">
                <ArrowLeft className="size-4" aria-hidden />
                Back to home
              </Link>
            </Button>
          </div>
        </div>
      </Container>
    </Section>
  );
}
