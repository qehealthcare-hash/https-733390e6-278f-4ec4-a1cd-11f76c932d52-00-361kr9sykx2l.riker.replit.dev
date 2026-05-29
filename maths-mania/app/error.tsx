"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Navbar } from "@/components/sections/navbar";
import { Footer } from "@/components/sections/footer";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { FadeIn } from "@/components/ui/fade-in";

type ErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error("[app-error]", error);
  }, [error]);

  return (
    <div className="flex min-h-svh flex-col">
      <Navbar />
      <main className="flex-1">
        <Section padding="lg" tone="default">
          <Container size="sm" className="text-center">
            <FadeIn>
              <p className="font-mono text-6xl font-bold text-[var(--color-error)]">
                500
              </p>
              <Heading as="h1" size="h2" className="mt-4">
                Something went wrong
              </Heading>
              <p className="mt-4 text-lg text-[var(--color-text-muted)]">
                Our servers did the maths and got an unexpected result. Your
                in-progress exam attempt is still on our side if you were
                mid-test — try refreshing or head back to the dashboard.
              </p>
              {error.digest && (
                <p className="mt-2 font-mono text-xs text-[var(--color-text-faint)]">
                  Reference: {error.digest}
                </p>
              )}
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Button type="button" variant="primary" size="lg" onClick={reset}>
                  Try again
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link href="/dashboard">Dashboard</Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link href="/">Home</Link>
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
