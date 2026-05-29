import type { LegalSection } from "@/lib/legal";

export function LegalDocument({
  sections,
  lastUpdated,
}: {
  sections: LegalSection[];
  lastUpdated: string;
}) {
  return (
    <article className="prose prose-neutral dark:prose-invert max-w-none">
      <p className="text-sm text-[var(--color-text-muted)]">
        Last updated: {lastUpdated}
      </p>
      <nav className="not-prose mt-8 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          On this page
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
          {sections.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="text-[var(--color-primary-600)] hover:underline"
              >
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {sections.map((section) => (
        <section key={section.id} id={section.id} className="mt-10 scroll-mt-24">
          <h2 className="font-display text-xl font-bold text-[var(--color-text)]">
            {section.title}
          </h2>
          {section.paragraphs.map((p, i) => (
            <p
              key={i}
              className="mt-3 text-sm leading-relaxed text-[var(--color-text-muted)]"
            >
              {p}
            </p>
          ))}
        </section>
      ))}
    </article>
  );
}
