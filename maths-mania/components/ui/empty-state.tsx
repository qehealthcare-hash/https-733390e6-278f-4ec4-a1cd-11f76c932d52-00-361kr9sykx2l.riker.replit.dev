import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { FadeIn } from "@/components/ui/fade-in";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; href: string };
  className?: string;
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <FadeIn
      className={cn(
        "rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)]",
        "bg-[var(--color-surface-muted)] px-6 py-10 text-center",
        className,
      )}
    >
      {Icon && (
        <Icon
          className="mx-auto size-10 text-[var(--color-text-faint)]"
          aria-hidden
        />
      )}
      <Heading as="h2" size="h4" className={Icon ? "mt-4" : undefined}>
        {title}
      </Heading>
      {description && (
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-text-muted)]">
          {description}
        </p>
      )}
      {action && (
        <Button asChild className="mt-6" variant="primary" size="sm">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      )}
    </FadeIn>
  );
}
