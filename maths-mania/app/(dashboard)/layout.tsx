import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { UserMenu } from "@/components/auth/user-menu";
import { requireAuth } from "@/lib/auth/guard";
import { cn } from "@/lib/utils";

const SIDEBAR_LINKS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/exams", label: "My exams" },
  { href: "/dashboard/profile", label: "Profile" },
  { href: "/dashboard/certificates", label: "Certificates" },
] as const;

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

      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-8 px-4 py-8 sm:px-6">
        <aside className="hidden w-48 shrink-0 lg:block">
          <nav aria-label="Dashboard">
            <ul className="space-y-1">
              {SIDEBAR_LINKS.map((link) => (
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
            </ul>
          </nav>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
