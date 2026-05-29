import Link from "next/link";
import { Navbar } from "@/components/sections/navbar";
import { Footer } from "@/components/sections/footer";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { FadeIn } from "@/components/ui/fade-in";

export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col">
      <Navbar />
      <main className="flex-1">
        <Section padding="lg" tone="notebook">
          <Container size="sm" className="text-center">
            <FadeIn>
              <p className="font-mono text-6xl font-bold text-[var(--color-primary-500)]">
                404
              </p>
              <Heading as="h1" size="h2" className="mt-4">
                This page is undefined
              </Heading>
              <p className="mt-4 text-lg text-[var(--color-text-muted)]">
                We searched every interval, but{" "}
                <span className="font-mono text-[var(--color-text)]">
                  lim<sub>x→404</sub> page(x)
                </span>{" "}
                does not exist.
              </p>
              <p className="mt-2 text-sm text-[var(--color-text-faint)]">
                (Don&apos;t worry — your exam answers are saved. This URL is not.)
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Button asChild variant="primary" size="lg">
                  <Link href="/">Home</Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link href="/exams">Live exams</Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link href="/quiz">Practice quiz</Link>
                </Button>
              </div>
            </FadeIn>
          </Container>
        </Section>
      </main>
      <Footer />
    </div>
  );
}
