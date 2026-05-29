import type { Metadata } from "next";
import { HeroSection } from "@/components/sections/hero";
import { PillarsSection } from "@/components/sections/pillars";
import { VideoGridSection } from "@/components/sections/video-grid";
import { TricksSection } from "@/components/sections/tricks";
import { ResourcesPreviewSection } from "@/components/sections/resources-preview";
import { TestimonialsSection } from "@/components/sections/testimonials";
import { LiveExamCtaSection } from "@/components/sections/live-exam-cta";
import { MeritTeaserSection } from "@/components/sections/merit-teaser";
import { FaqSection } from "@/components/sections/faq";
import { FaqJsonLd } from "@/components/sections/faq-json-ld";
import { NewsletterSection } from "@/components/sections/newsletter";
import { getFaqs } from "@/lib/content";
import { SITE } from "@/lib/site";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: `${SITE.name} — ${SITE.tagline}`,
  description: SITE.shortDescription,
  path: "/",
});

export default function Home() {
  const faqs = getFaqs();

  return (
    <>
      <FaqJsonLd />
      <HeroSection />
      <PillarsSection />
      <VideoGridSection />
      <TricksSection />
      <ResourcesPreviewSection />
      <TestimonialsSection />
      <LiveExamCtaSection />
      <MeritTeaserSection />
      <FaqSection items={faqs} />
      <NewsletterSection />
    </>
  );
}
