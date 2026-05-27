import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PillarIcon } from "@/components/illustrations/pillar-icon";
import { Card, CardBody } from "@/components/ui/card";
import type { Pillar } from "@/lib/site";
import { cn } from "@/lib/utils";

const ACCENT: Record<Pillar["accent"], string> = {
  primary:
    "hover:shadow-[var(--shadow-pop)] [--pillar:var(--color-primary-500)]",
  secondary:
    "hover:shadow-[var(--shadow-card)] [--pillar:var(--color-secondary-500)]",
  accent:
    "hover:shadow-[var(--shadow-card)] [--pillar:var(--color-accent-500)]",
};

type PillarCardProps = {
  pillar: Pillar;
  featured?: boolean;
  /** Mock stat until CMS */
  stat?: string;
};

export function PillarCard({ pillar, featured, stat = "4,200+ students" }: PillarCardProps) {
  const href = pillar.slug === "exams" ? "/exams" : `/courses/${pillar.slug}`;

  return (
    <Card
      className={cn(
        "group h-full hover:-translate-y-0.5",
        ACCENT[pillar.accent],
        featured && "border-[var(--color-primary-200)] md:row-span-2",
      )}
    >
      <CardBody className="flex h-full flex-col">
        <div
          className="mb-4 inline-flex size-12 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-surface-alt)] text-[var(--pillar)]"
        >
          <PillarIcon slug={pillar.slug} />
        </div>
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          {pillar.tag}
        </p>
        <h3 className="mt-2 font-display text-xl font-bold text-[var(--color-text)]">
          {pillar.label}
        </h3>
        <p className="mt-2 flex-1 text-sm leading-relaxed text-[var(--color-text-muted)]">
          {pillar.blurb}
        </p>
        <p className="mt-3 font-mono text-xs text-[var(--color-text-faint)]">
          {stat}
        </p>
        <Link
          href={href}
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-primary-600)] transition-colors group-hover:gap-2"
        >
          {pillar.slug === "exams" ? "Register free" : "View lessons"}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </CardBody>
    </Card>
  );
}
