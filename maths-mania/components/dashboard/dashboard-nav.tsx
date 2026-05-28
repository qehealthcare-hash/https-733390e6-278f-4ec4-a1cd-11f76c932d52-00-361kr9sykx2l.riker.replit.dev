"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/dashboard", label: "Overview", exact: true },
  { href: "/dashboard/exams", label: "My exams" },
  { href: "/dashboard/certificates", label: "Certificates" },
  { href: "/dashboard/profile", label: "Profile" },
] as const;

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Dashboard">
      <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0">
        {LINKS.map((link) => {
          const active =
            "exact" in link && link.exact
              ? pathname === link.href
              : pathname === link.href ||
                pathname.startsWith(`${link.href}/`);
          return (
            <li key={link.href} className="shrink-0 lg:shrink">
              <Link
                href={link.href}
                className={cn(
                  "block whitespace-nowrap rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium transition",
                  active
                    ? "bg-[var(--color-primary-50)] text-[var(--color-primary-700)] dark:bg-[var(--color-primary-950)] dark:text-[var(--color-primary-300)]"
                    : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)]",
                )}
                aria-current={active ? "page" : undefined}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
