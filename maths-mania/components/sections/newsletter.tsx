"use client";

import * as React from "react";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function NewsletterSection() {
  const [email, setEmail] = React.useState("");
  const [status, setStatus] = React.useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [message, setMessage] = React.useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setStatus("loading");
    setMessage("");

    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };

      if (!res.ok) {
        setStatus("error");
        setMessage(data.message ?? "Something went wrong. Try again.");
        return;
      }

      setStatus("success");
      setMessage("You're in! Check your inbox Sunday morning for the exam reminder.");
      setEmail("");
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  }

  return (
    <Section padding="md" tone="notebook" id="newsletter">
      <Container size="md">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-display text-2xl font-bold text-[var(--color-text)]">
            One maths trick every Sunday
          </p>
          <p className="mt-3 text-[var(--color-text-muted)]">
            Plus a reminder for that day&apos;s live exam. No spam, no upsell.
          </p>

          <form
            onSubmit={handleSubmit}
            className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-stretch"
          >
            <label htmlFor="newsletter-email" className="sr-only">
              Email address
            </label>
            <input
              id="newsletter-email"
              type="email"
              name="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={status === "loading"}
              className={cn(
                "h-12 flex-1 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-5 text-base",
                "text-[var(--color-text)] placeholder:text-[var(--color-text-faint)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-500)]",
              )}
            />
            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={status === "loading"}
              className="shrink-0"
            >
              {status === "loading" ? "Submitting…" : "Subscribe"}
            </Button>
          </form>

          {message && (
            <p
              role="status"
              className={cn(
                "mt-4 text-sm",
                status === "success"
                  ? "text-[var(--color-success)]"
                  : "text-[var(--color-error)]",
              )}
            >
              {message}
            </p>
          )}
        </div>
      </Container>
    </Section>
  );
}
