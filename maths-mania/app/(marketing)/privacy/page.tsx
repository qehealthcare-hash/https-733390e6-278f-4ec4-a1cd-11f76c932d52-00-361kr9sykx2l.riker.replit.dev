import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { LegalDocument } from "@/components/sections/legal-document";
import { PRIVACY_SECTIONS } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Maths Mania collects, uses, and protects your personal data.",
};

const LAST_UPDATED = "28 May 2026";

export default function PrivacyPage() {
  return (
    <Section padding="lg" tone="default">
      <Container size="md">
        <Eyebrow tone="muted">Legal</Eyebrow>
        <Heading as="h1" size="h1" className="mt-4">
          Privacy policy
        </Heading>
        <div className="mt-10">
          <LegalDocument sections={PRIVACY_SECTIONS} lastUpdated={LAST_UPDATED} />
        </div>
      </Container>
    </Section>
  );
}
