import { getFaqs } from "@/lib/content";
import { JsonLd } from "@/components/seo/json-ld";

/** FAQPage JSON-LD for SEO (§7). */
export function FaqJsonLd() {
  const faqs = getFaqs();
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: f.answer,
      },
    })),
  };

  return <JsonLd data={schema} />;
}
