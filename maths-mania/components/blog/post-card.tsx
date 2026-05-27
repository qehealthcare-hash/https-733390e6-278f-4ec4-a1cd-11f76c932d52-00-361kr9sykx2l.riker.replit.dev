import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import type { BlogPostSummary } from "@/lib/blog";
import { formatPostDate } from "@/lib/blog";
import { cn } from "@/lib/utils";

type PostCardProps = {
  post: BlogPostSummary;
  className?: string;
};

export function PostCard({ post, className }: PostCardProps) {
  return (
    <Card className={cn("h-full transition hover:-translate-y-0.5", className)}>
      <CardBody className="flex h-full flex-col">
        <div className="flex flex-wrap gap-2">
          {post.tags.map((tag) => (
            <Link
              key={tag}
              href={`/blog?tag=${encodeURIComponent(tag)}`}
              className="rounded-full bg-[var(--color-surface-alt)] px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)] hover:text-[var(--color-primary-600)]"
            >
              {tag}
            </Link>
          ))}
        </div>
        <h2 className="mt-4 font-display text-xl font-bold text-[var(--color-text)]">
          <Link href={`/blog/${post.slug}`} className="hover:text-[var(--color-primary-600)]">
            {post.title}
          </Link>
        </h2>
        <p className="mt-2 flex-1 text-sm text-[var(--color-text-muted)]">
          {post.description}
        </p>
        <div className="mt-4 flex items-center justify-between gap-4 text-xs text-[var(--color-text-faint)]">
          <span>{formatPostDate(post.date)}</span>
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" aria-hidden />
            {post.readTimeMinutes} min read
          </span>
        </div>
        <Link
          href={`/blog/${post.slug}`}
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-primary-600)]"
        >
          Read article
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </CardBody>
    </Card>
  );
}
