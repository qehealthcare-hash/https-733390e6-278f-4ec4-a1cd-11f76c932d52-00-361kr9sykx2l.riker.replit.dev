import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { UserMenu } from "@/components/auth/user-menu";
import { DashboardNav } from "@/components/dashboard/dashboard-nav";
import { requireAuth } from "@/lib/auth/guard";
import { NOINDEX_ROBOTS } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: NOINDEX_ROBOTS,
};

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireAuth({ requireOnboarded: true });

  return (
    <div className="flex min-h-svh flex-col bg-[var(--color-bg)]">
      <a
        href="#dashboard-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-[var(--color-primary-500)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to dashboard content
      </a>
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="Maths Mania — home">
            <Logo />
          </Link>
          <UserMenu />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:gap-8 lg:py-8">
        <aside className="lg:w-48 lg:shrink-0" aria-label="Dashboard navigation">
          <DashboardNav />
        </aside>
        <main id="dashboard-main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
