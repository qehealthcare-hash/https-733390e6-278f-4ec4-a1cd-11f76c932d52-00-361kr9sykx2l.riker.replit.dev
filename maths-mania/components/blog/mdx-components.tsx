import type { ReactNode } from "react";
import type { MDXComponents } from "mdx/types";
import Link from "next/link";
import { LatexBlock } from "@/components/math/latex-block";
import { cn } from "@/lib/utils";

type MathProps = { math: string; display?: boolean };

function Math({ math, display }: MathProps) {
  return <LatexBlock math={math} display={display} />;
}

function Callout({
  title,
  children,
  variant = "tip",
}: {
  title?: string;
  children: ReactNode;
  variant?: "tip" | "warn";
}) {
  return (
    <aside
      className={cn(
        "my-6 rounded-[var(--radius-lg)] border px-5 py-4 text-sm",
        variant === "tip" &&
          "border-[var(--color-primary-200)] bg-[var(--color-primary-50)]",
        variant === "warn" &&
          "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30",
      )}
    >
      {title && (
        <p className="mb-2 font-semibold text-[var(--color-text)]">{title}</p>
      )}
      <div className="text-[var(--color-text-muted)]">{children}</div>
    </aside>
  );
}

export const blogMdxComponents: MDXComponents = {
  Math,
  Callout,
  LatexBlock,
  a: ({ href, children, ...props }) => {
    const isExternal =
      typeof href === "string" &&
      (href.startsWith("http") || href.startsWith("mailto:"));
    if (isExternal) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-[var(--color-primary-600)] underline-offset-2 hover:underline"
          {...props}
        >
          {children}
        </a>
      );
    }
    return (
      <Link
        href={href ?? "#"}
        className="font-medium text-[var(--color-primary-600)] underline-offset-2 hover:underline"
        {...props}
      >
        {children}
      </Link>
    );
  },
  h2: (props) => (
    <h2
      className="mt-10 scroll-mt-24 font-display text-2xl font-bold text-[var(--color-text)] first:mt-0"
      {...props}
    />
  ),
  h3: (props) => (
    <h3
      className="mt-8 font-display text-xl font-semibold text-[var(--color-text)]"
      {...props}
    />
  ),
  p: (props) => (
    <p
      className="mt-4 leading-relaxed text-[var(--color-text-muted)]"
      {...props}
    />
  ),
  ul: (props) => (
    <ul
      className="mt-4 list-disc space-y-2 pl-6 text-[var(--color-text-muted)]"
      {...props}
    />
  ),
  ol: (props) => (
    <ol
      className="mt-4 list-decimal space-y-2 pl-6 text-[var(--color-text-muted)]"
      {...props}
    />
  ),
  li: (props) => <li className="leading-relaxed" {...props} />,
  blockquote: (props) => (
    <blockquote
      className="mt-6 border-l-4 border-[var(--color-primary-400)] pl-4 italic text-[var(--color-text)]"
      {...props}
    />
  ),
  code: (props) => (
    <code
      className="rounded bg-[var(--color-surface-alt)] px-1.5 py-0.5 font-mono text-sm text-[var(--color-text)]"
      {...props}
    />
  ),
  hr: () => <hr className="my-10 border-[var(--color-border)]" />,
};
