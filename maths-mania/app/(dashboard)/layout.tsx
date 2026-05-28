import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { UserMenu } from "@/components/auth/user-menu";
import { DashboardNav } from "@/components/dashboard/dashboard-nav";
import { requireAuth } from "@/lib/auth/guard";

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireAuth({ requireOnboarded: true });

  return (
    <div className="flex min-h-svh flex-col bg-[var(--color-bg)]">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="Maths Mania — home">
            <Logo />
          </Link>
          <UserMenu />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:gap-8 lg:py-8">
        <aside className="lg:w-48 lg:shrink-0">
          <DashboardNav />
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
