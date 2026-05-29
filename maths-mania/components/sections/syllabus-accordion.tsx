"use client";

import * as Accordion from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";
import type { SyllabusChapter } from "@/lib/courses";
import { cn } from "@/lib/utils";

type SyllabusAccordionProps = {
  chapters: SyllabusChapter[];
};

export function SyllabusAccordion({ chapters }: SyllabusAccordionProps) {
  return (
    <Accordion.Root
      type="multiple"
      defaultValue={[chapters[0]?.title ?? "0"]}
      className="divide-y divide-[var(--color-border)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]"
    >
      {chapters.map((chapter, idx) => (
        <Accordion.Item key={chapter.title} value={chapter.title}>
          <Accordion.Header>
            <Accordion.Trigger
              className={cn(
                "flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-semibold text-[var(--color-text)]",
                "hover:bg-[var(--color-surface-alt)] data-[state=open]:bg-[var(--color-surface-alt)]",
                "group",
              )}
            >
              <span className="flex items-center gap-3">
                <span className="flex size-7 items-center justify-center rounded-full bg-[var(--color-surface-alt)] font-mono text-xs text-[var(--color-text-muted)]">
                  {idx + 1}
                </span>
                {chapter.title}
              </span>
              <ChevronDown
                className="size-4 shrink-0 text-[var(--color-text-muted)] transition-transform group-data-[state=open]:rotate-180"
                aria-hidden
              />
            </Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Content className="overflow-hidden">
            <ul className="space-y-2 px-5 pb-5 pl-16">
              {chapter.topics.map((topic) => (
                <li
                  key={topic}
                  className="flex items-start gap-2 text-sm text-[var(--color-text-muted)]"
                >
                  <span
                    className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--color-primary-500)]"
                    aria-hidden
                  />
                  {topic}
                </li>
              ))}
            </ul>
          </Accordion.Content>
        </Accordion.Item>
      ))}
    </Accordion.Root>
  );
}
