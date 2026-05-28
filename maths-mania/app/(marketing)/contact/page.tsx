import type { Metadata } from "next";
import Link from "next/link";
import { Mail, MessageCircle } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { ContactForm } from "@/components/sections/contact-form";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Get in touch with Maths Mania — WhatsApp, email, or contact form. Usually replies within 24 hours.",
};

function whatsappHref() {
  const num = SITE.social.whatsapp.replace(/\D/g, "");
  if (!num) return null;
  return `https://wa.me/${num}`;
}

export default function ContactPage() {
  const wa = whatsappHref();

  return (
    <>
      <Section padding="lg" tone="notebook">
        <Container>
          <Eyebrow tone="secondary">Contact</Eyebrow>
          <Heading as="h1" size="h1" className="mt-4 max-w-2xl">
            Ask us anything
          </Heading>
          <p className="mt-4 max-w-xl text-lg text-[var(--color-text-muted)]">
            Exam registration, course doubt, or partnership — we read every message.
            Typical reply within one working day.
          </p>
        </Container>
      </Section>

      <Section padding="lg" tone="default">
        <Container>
          <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
            <div className="space-y-6">
              <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
                <div className="flex items-start gap-3">
                  <Mail
                    className="size-5 shrink-0 text-[var(--color-primary-600)]"
                    aria-hidden
                  />
                  <div>
                    <p className="font-semibold text-[var(--color-text)]">Email</p>
                    <a
                      href={`mailto:${SITE.email}`}
                      className="mt-1 text-sm text-[var(--color-primary-600)] hover:underline"
                    >
                      {SITE.email}
                    </a>
                  </div>
                </div>
              </div>

              {wa && (
                <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
                  <div className="flex items-start gap-3">
                    <MessageCircle
                      className="size-5 shrink-0 text-[var(--color-success-600)]"
                      aria-hidden
                    />
                    <div>
                      <p className="font-semibold text-[var(--color-text)]">
                        WhatsApp
                      </p>
                      <a
                        href={wa}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-block text-sm text-[var(--color-primary-600)] hover:underline"
                      >
                        Chat on WhatsApp →
                      </a>
                      <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                        Best for quick exam-day questions.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <p className="text-sm text-[var(--color-text-muted)]">
                Follow updates on{" "}
                <Link
                  href={SITE.social.youtube}
                  className="font-medium text-[var(--color-primary-600)] hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  YouTube
                </Link>{" "}
                and{" "}
                <Link
                  href={SITE.social.instagram}
                  className="font-medium text-[var(--color-primary-600)] hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Instagram
                </Link>
                .
              </p>
            </div>

            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-soft)]">
              <Heading as="h2" size="h4">
                Send a message
              </Heading>
              <div className="mt-6">
                <ContactForm />
              </div>
            </div>
          </div>
        </Container>
      </Section>
    </>
  );
}
