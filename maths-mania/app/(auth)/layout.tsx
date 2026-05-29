import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { NOINDEX_ROBOTS } from "@/lib/seo";

export const metadata: Metadata = {
  robots: NOINDEX_ROBOTS,
};

/**
 * Auth route group — no marketing navbar/footer.
 * Clean focus for login, signup, OTP verify, and onboarding.
 */
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-svh flex-col bg-[var(--color-bg)]">
      <a
        href="#auth-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-[var(--color-primary-500)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to sign in form
      </a>
      <header className="border-b border-[var(--color-border)] px-4 py-4 sm:px-6">
        <Link href="/" aria-label="Maths Mania — home">
          <Logo />
        </Link>
      </header>
      <main
        id="auth-main"
        className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-6"
      >
        <div className="w-full max-w-md">{children}</div>
      </main>
      <footer className="border-t border-[var(--color-border)] px-4 py-6 text-center text-xs text-[var(--color-text-faint)]">
        <Link href="/privacy" className="hover:text-[var(--color-text-muted)]">
          Privacy
        </Link>
        {" · "}
        <Link href="/terms" className="hover:text-[var(--color-text-muted)]">
          Terms
        </Link>
      </footer>
    </div>
  );
}
