import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Heading } from "@/components/ui/heading";
import { CertificateVerifyForm } from "@/components/certificates/certificate-verify-form";

export const metadata: Metadata = {
  title: "Certificate verification",
  description:
    "Verify the authenticity of a Maths Mania merit-list certificate by entering the 12-character verification code.",
};

export default function CertificateVerifyPage() {
  return (
    <Section padding="lg" tone="default">
      <Container size="md">
        <Heading as="h1" size="h1">
          Certificate verification
        </Heading>
        <p className="mt-4 max-w-xl text-[var(--color-text-muted)]">
          Enter the 12-character code printed on any Maths Mania merit
          certificate to confirm the rank, score, and exam name. Issued only to
          top 10% rankers; verifiable forever.
        </p>
        <CertificateVerifyForm className="mt-10" />
      </Container>
    </Section>
  );
}
