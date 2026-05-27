"use client";

import * as Accordion from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import type { FAQ } from "@/lib/content";
import { cn } from "@/lib/utils";

export function FaqSection({ items }: { items: FAQ[] }) {
  return (
    <Section padding="lg" tone="alt" id="faq">
      <Container size="md">
        <Eyebrow tone="muted">FAQ</Eyebrow>
        <Heading as="h2" size="h2" className="mt-3">
          Common questions
        </Heading>

        <Accordion.Root
          type="single"
          collapsible
          className="mt-10 divide-y divide-[var(--color-border)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]"
        >
          {items.map((item) => (
            <Accordion.Item key={item.id} value={item.id}>
              <Accordion.Header>
                <Accordion.Trigger
                  className={cn(
                    "flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-sm font-semibold text-[var(--color-text)]",
                    "transition-colors hover:bg-[var(--color-surface-alt)]",
                    "data-[state=open]:bg-[var(--color-surface-alt)]",
                    "group",
                  )}
                >
                  {item.question}
                  <ChevronDown
                    className="size-4 shrink-0 text-[var(--color-text-muted)] transition-transform group-data-[state=open]:rotate-180"
                    aria-hidden
                  />
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content className="overflow-hidden">
                <div className="px-5 pb-4 text-sm leading-relaxed text-[var(--color-text-muted)]">
                  {item.answer}
                </div>
              </Accordion.Content>
            </Accordion.Item>
          ))}
        </Accordion.Root>
      </Container>
    </Section>
  );
}
