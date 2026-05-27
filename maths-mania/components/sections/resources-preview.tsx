import Link from "next/link";
import { FileText, Download } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { RESOURCES_PREVIEW } from "@/lib/home-data";

export function ResourcesPreviewSection() {
  return (
    <Section padding="lg" tone="alt">
      <Container>
        <div className="grid gap-12 lg:grid-cols-12 lg:items-start">
          <div className="lg:col-span-5">
            <Heading as="h2" size="h2">
              Notes that don&apos;t waste your time
            </Heading>
            <p className="mt-4 text-lg leading-relaxed text-[var(--color-text-muted)]">
              Formula sheets, cheatsheets, and revision PDFs — curated for boards
              and competitive exams. Download free; we&apos;ll ask for your email
              once (you can skip it for now).
            </p>
            <Button asChild variant="outline" className="mt-6">
              <Link href="/resources">Browse all resources</Link>
            </Button>
          </div>

          <ul className="grid gap-4 sm:grid-cols-2 lg:col-span-7">
            {RESOURCES_PREVIEW.map((resource) => (
              <li key={resource.id}>
                <Link
                  href={resource.href}
                  className="flex gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-soft)] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)]"
                >
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-surface-alt)] text-[var(--color-primary-500)]">
                    <FileText className="size-6" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-[var(--color-text)]">
                      {resource.title}
                    </span>
                    <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
                      {resource.pages} pages · {resource.size}
                    </span>
                    <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-primary-600)]">
                      <Download className="size-3.5" aria-hidden />
                      Download free
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </Section>
  );
}
