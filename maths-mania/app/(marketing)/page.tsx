/**
 * Home — milestone 2 transitional state.
 *
 * The duplicated header/footer that the milestone-1 placeholder rendered
 * inside the page is gone; the new (marketing) layout provides the real
 * Navbar + Footer around this content. The hero body stays as a
 * still-useful "tokens working" verification until milestone 3 replaces
 * it with the production hero per §5.1.
 */
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import { SITE } from "@/lib/site";
import Link from "next/link";

export default function Home() {
  return (
    <>
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
              {SITE.shortDescription} Milestone 2 just wired the navbar and
              footer around this page — try the hamburger on mobile, scroll
              this page to see the navbar shrink, and tab from anywhere to
              see the skip-link appear.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" variant="primary">
                <Link href="/exams">
                  Register for Sunday&apos;s exam
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a
                  href={SITE.social.youtube}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Subscribe on YouTube
                </a>
              </Button>
              <Button asChild size="lg" variant="ghost">
                <Link href="/courses">Browse free lessons</Link>
              </Button>
            </div>

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

          <aside className="md:col-span-5">
            <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-card)]">
              <Eyebrow tone="secondary">Milestones</Eyebrow>
              <Heading as="h2" size="h3" className="mt-3">
                2 of 22 done.
              </Heading>

              <ul className="mt-6 space-y-2.5 text-sm">
                {[
                  { done: true, label: "Brand foundation (m1)" },
                  { done: true, label: "Navbar + Footer + marketing layout (m2)" },
                  { done: false, label: "Hero + Five Pillars + Footer wired (m3)" },
                  { done: false, label: "YouTube latest videos (m4)" },
                  { done: false, label: "Course pillar pages (m5)" },
                  { done: false, label: "Resources + lead-gate (m6)" },
                  { done: false, label: "Blog + MDX + KaTeX (m7)" },
                  { done: false, label: "Self-paced Quiz (m8)" },
                  { done: false, label: "Supabase foundation (m9)" },
                  { done: false, label: "Auth flows (m10)" },
                  { done: false, label: "Exam admin (m11)" },
                  { done: false, label: "Exam student flow (m12-13)" },
                  { done: false, label: "Grading + merit + cert (m14)" },
                  { done: false, label: "Student dashboard (m15)" },
                  { done: false, label: "Polish + perf + a11y + deploy (m16-22)" },
                ].map((m) => (
                  <li key={m.label} className="flex items-start gap-2">
                    <CheckCircle2
                      className={
                        m.done
                          ? "mt-0.5 size-4 shrink-0 text-[var(--color-success)]"
                          : "mt-0.5 size-4 shrink-0 text-[var(--color-text-faint)]"
                      }
                      aria-hidden
                    />
                    <span
                      className={
                        m.done
                          ? "text-[var(--color-text)]"
                          : "text-[var(--color-text-muted)]"
                      }
                    >
                      {m.label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </Container>
      </Section>
    </>
  );
}
