import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { ResourcesLibrary } from "@/components/sections/resources-library";
import { parseCategoryParam } from "@/lib/resources";

export const metadata: Metadata = {
  title: "Free Resources — Notes, Formula Sheets, Cheatsheets",
  description:
    "Download free PDF formula sheets, banking quant cheatsheets, SSC previous-year analysis, and Vedic maths starter notes from Maths Mania.",
};

type Props = {
  searchParams: Promise<{ type?: string }>;
};

export default async function ResourcesPage({ searchParams }: Props) {
  const { type } = await searchParams;
  const initialCategory = parseCategoryParam(type);

  return (
    <>
      <Section padding="lg" tone="notebook">
        <Container>
          <Eyebrow tone="primary">Free downloads</Eyebrow>
          <Heading as="h1" size="h1" className="mt-4 max-w-2xl">
            Notes that don&apos;t waste your time
          </Heading>
          <p className="mt-4 max-w-2xl text-lg text-[var(--color-text-muted)]">
            Curated PDFs for boards and competitive exams — formula sheets,
            cheatsheets, previous-year analysis, and quick revision. Every file
            is free. We may ask for your email once; you can always skip and
            download anyway.
          </p>
        </Container>
      </Section>

      <Section padding="lg" tone="default">
        <Container>
          <ResourcesLibrary initialCategory={initialCategory} />
        </Container>
      </Section>
    </>
  );
}
