import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { LegalDocument } from "@/components/sections/legal-document";
import { TERMS_SECTIONS } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms for using Maths Mania content, accounts, and live exams.",
};

const LAST_UPDATED = "28 May 2026";

export default function TermsPage() {
  return (
    <Section padding="lg" tone="default">
      <Container size="md">
        <Eyebrow tone="muted">Legal</Eyebrow>
        <Heading as="h1" size="h1" className="mt-4">
          Terms of service
        </Heading>
        <div className="mt-10">
          <LegalDocument sections={TERMS_SECTIONS} lastUpdated={LAST_UPDATED} />
        </div>
      </Container>
    </Section>
  );
}
