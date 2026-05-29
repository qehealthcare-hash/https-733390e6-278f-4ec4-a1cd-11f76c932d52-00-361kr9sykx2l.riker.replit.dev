import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { requireAdmin } from "@/lib/auth/guard";
import { NOINDEX_ROBOTS } from "@/lib/seo";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Admin",
  robots: NOINDEX_ROBOTS,
};

const LINKS = [
  { href: "/admin/exams", label: "Exams" },
  { href: "/admin/exams/new", label: "New exam" },
] as const;

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireAdmin();

  return (
    <div className="flex min-h-svh flex-col bg-[var(--color-bg)]">
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-[var(--color-primary-500)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to admin content
      </a>
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/admin/exams" aria-label="Maths Mania Admin">
            <Logo />
          </Link>
          <span className="rounded-full bg-[var(--color-primary-100)] px-3 py-1 text-xs font-semibold text-[var(--color-primary-800)] dark:bg-[var(--color-primary-900)]/40 dark:text-[var(--color-primary-100)]">
            Admin
          </span>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-8 px-4 py-8 sm:px-6">
        <aside className="hidden w-44 shrink-0 md:block">
          <nav aria-label="Admin">
            <ul className="space-y-1">
              {LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className={cn(
                      "block rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)]",
                    )}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
              <li className="pt-4">
                <Link
                  href="/"
                  className="block px-3 py-2 text-sm text-[var(--color-text-faint)] hover:text-[var(--color-text)]"
                >
                  ← Site
                </Link>
              </li>
            </ul>
          </nav>
        </aside>
        <main id="admin-main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
