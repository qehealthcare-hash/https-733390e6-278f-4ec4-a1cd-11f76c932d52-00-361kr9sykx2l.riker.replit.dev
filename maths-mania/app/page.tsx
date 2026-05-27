/**
 * Milestone 1 placeholder home.
 *
 * The purpose of this page is to prove — visually, in the running app —
 * that the brand foundation works:
 *  - Fraunces serif for the display headline
 *  - Plus Jakarta Sans for body
 *  - JetBrains Mono for numerals
 *  - oklch palette (primary red, secondary indigo, accent yellow)
 *  - Light + dark surfaces via [data-theme="dark"]
 *  - Theme toggle (light / system / dark)
 *  - All primitives: Container, Section, Eyebrow, Heading, Button, Logo
 *
 * Milestone 2 replaces this with the full Hero + Five Pillars + the rest
 * of §5.1 of the brief.
 */
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { SITE } from "@/lib/site";
import { ArrowRight, CheckCircle2, Sparkles } from "lucide-react";

export default function Home() {
  return (
    <main className="min-h-svh">
      {/* Top bar — minimal, just enough to anchor the theme toggle */}
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]/80 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-surface)]/60">
        <Container as="div" className="flex h-16 items-center justify-between">
          <Logo />
          <div className="flex items-center gap-3">
            <span className="hidden text-xs font-medium text-[var(--color-text-muted)] sm:inline">
              Milestone 1 · brand system
            </span>
            <ThemeToggle />
          </div>
        </Container>
      </header>

      {/* Hero strip — proves typography + spacing + buttons */}
      <Section padding="lg" tone="notebook">
        <Container className="grid gap-12 md:grid-cols-12 md:items-center">
          <div className="md:col-span-7">
            <Eyebrow tone="primary">
              <Sparkles className="size-3" aria-hidden /> Brand foundation
            </Eyebrow>

            <Heading
              as="h1"
              size="display"
              className="mt-5 text-[var(--color-text)]"
            >
              Maths, finally,{" "}
              <span className="text-[var(--color-primary-500)]">makes sense.</span>
            </Heading>

            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[var(--color-text-muted)]">
              {SITE.shortDescription} This is the milestone 1 scaffold —
              every component you see (buttons, headings, the pill toggle in the
              header, the editorial serif, the notebook background) is wired to
              the design tokens defined in <code className="rounded bg-[var(--color-surface-alt)] px-1.5 py-0.5 font-mono text-sm">globals.css</code>.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" variant="primary">
                Register for Sunday&apos;s exam
                <ArrowRight className="size-4" aria-hidden />
              </Button>
              <Button size="lg" variant="outline">
                Subscribe on YouTube
              </Button>
              <Button size="lg" variant="ghost">
                Browse free lessons
              </Button>
            </div>

            {/* Numerals demo — proves JetBrains Mono is wired correctly */}
            <dl className="mt-12 grid max-w-lg grid-cols-3 gap-6 border-t border-[var(--color-border)] pt-8">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                  Live exam
                </dt>
                <dd className="mt-1 font-mono text-2xl font-bold text-[var(--color-text)] tabular-nums">
                  02:14:33
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                  Registered
                </dt>
                <dd className="mt-1 font-mono text-2xl font-bold text-[var(--color-text)] tabular-nums">
                  1,847
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                  Top score
                </dt>
                <dd className="mt-1 font-mono text-2xl font-bold text-[var(--color-text)] tabular-nums">
                  96.5%
                </dd>
              </div>
            </dl>
          </div>

          {/* Token preview card — proves dark mode + shadows + radii */}
          <aside className="md:col-span-5">
            <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-card)]">
              <Eyebrow tone="secondary">Design tokens preview</Eyebrow>
              <Heading as="h2" size="h3" className="mt-3">
                Tokens, working.
              </Heading>

              {/* Palette swatches */}
              <ul className="mt-5 grid grid-cols-5 gap-2">
                {[
                  { name: "primary-500", v: "var(--color-primary-500)" },
                  { name: "primary-700", v: "var(--color-primary-700)" },
                  { name: "secondary-500", v: "var(--color-secondary-500)" },
                  { name: "accent-500", v: "var(--color-accent-500)" },
                  { name: "neutral-900", v: "var(--color-neutral-900)" },
                ].map((s) => (
                  <li key={s.name} className="flex flex-col items-center gap-1">
                    <span
                      className="block size-10 rounded-[var(--radius-sm)] border border-[var(--color-border)]"
                      style={{ background: s.v }}
                      aria-label={s.name}
                    />
                    <span className="font-mono text-[10px] text-[var(--color-text-faint)]">
                      {s.name.replace(/.+-/, "")}
                    </span>
                  </li>
                ))}
              </ul>

              {/* Verification checklist */}
              <ul className="mt-6 space-y-2 text-sm text-[var(--color-text-muted)]">
                {[
                  "Tailwind v4 @theme tokens loaded",
                  "Fraunces serif on headlines",
                  "Plus Jakarta Sans on body",
                  "JetBrains Mono on numerals",
                  "Dark mode via next-themes",
                  "Shadows, radii, focus ring tokens",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <CheckCircle2
                      className="mt-0.5 size-4 shrink-0 text-[var(--color-success)]"
                      aria-hidden
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </Container>
      </Section>

      {/* Footer — confirms tone="alt" surface tokens */}
      <footer className="border-t border-[var(--color-border)] bg-[var(--color-surface-alt)]">
        <Container className="flex flex-col items-start justify-between gap-4 py-8 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <Logo variant="mark" size={28} />
            <span className="text-sm text-[var(--color-text-muted)]">
              © {new Date().getFullYear()} {SITE.name} · Made in {SITE.city}, {SITE.country}
            </span>
          </div>
          <p className="text-xs text-[var(--color-text-faint)]">
            Milestone 1 of 22 · brand foundation locked in.
          </p>
        </Container>
      </footer>
    </main>
  );
}
