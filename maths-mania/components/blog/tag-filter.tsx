import Link from "next/link";
import { cn } from "@/lib/utils";

type TagFilterProps = {
  tags: string[];
  activeTag?: string;
};

export function TagFilter({ tags, activeTag }: TagFilterProps) {
  const items = [{ label: "All posts", tag: undefined }, ...tags.map((t) => ({ label: t, tag: t }))];

  return (
    <nav
      aria-label="Filter posts by topic"
      className="flex flex-wrap gap-2"
    >
      {items.map(({ label, tag }) => {
        const href = tag ? `/blog?tag=${encodeURIComponent(tag)}` : "/blog";
        const active =
          (!activeTag && !tag) ||
          (activeTag && tag && activeTag.toLowerCase() === tag.toLowerCase());
        return (
          <Link
            key={label}
            href={href}
            className={cn(
              "rounded-full border px-4 py-2 text-sm font-semibold transition",
              active
                ? "border-[var(--color-primary-500)] bg-[var(--color-primary-500)] text-white"
                : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:border-[var(--color-primary-300)]",
            )}
            aria-current={active ? "page" : undefined}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
