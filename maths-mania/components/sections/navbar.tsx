"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { MobileNav } from "@/components/sections/mobile-nav";
import { UserMenu } from "@/components/auth/user-menu";
import { NAV } from "@/lib/site";
import { cn } from "@/lib/utils";

/**
 * Navbar
 *
 * Sticky at the top of every marketing page. Behaviour:
 * - At scroll y=0, the navbar has a slightly larger vertical padding and
 *   a transparent background that blends into the hero.
 * - After scrolling >32px the background switches to a translucent
 *   surface with a backdrop-filter blur and a subtle bottom border —
 *   this is the "shrinks on scroll" behaviour from §6.
 * - Mobile (<lg) renders only the logo + theme toggle + hamburger.
 *   Tapping the hamburger opens the full-screen Radix Dialog drawer.
 *
 * Accessibility:
 * - <nav> with aria-label.
 * - Skip-link is rendered at the top of every page in the marketing layout.
 * - All link targets have a visible focus state via the global focus ring.
 */
export function Navbar() {
  const pathname = usePathname() ?? "/";
  const [scrolled, setScrolled] = React.useState(false);

  React.useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 32);
    handler();
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-40 transition-[padding,background-color,border-color,box-shadow] duration-200",
        scrolled
          ? "border-b border-[var(--color-border)] bg-[var(--color-surface)]/85 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-surface)]/65 shadow-[var(--shadow-soft)]"
          : "border-b border-transparent bg-transparent",
      )}
    >
      <Container
        as="div"
        className={cn(
          "flex items-center justify-between transition-[height] duration-200",
          scrolled ? "h-14" : "h-16 lg:h-20",
        )}
      >
        <Link
          href="/"
          aria-label="Maths Mania — home"
          className="rounded-md focus-visible:outline-none"
        >
          <Logo />
        </Link>

        {/* Desktop nav */}
        <nav
          aria-label="Primary"
          className="hidden lg:flex lg:items-center lg:gap-1"
        >
          {NAV.primary.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
                  active
                    ? "text-[var(--color-text)]"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
                )}
              >
                <span>{item.label}</span>
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-x-3.5 -bottom-px h-px bg-[var(--color-primary-500)]"
                  />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Right cluster: theme toggle + primary CTA + mobile drawer */}
        <div className="flex items-center gap-2">
          <UserMenu />
          <ThemeToggle className="hidden md:inline-flex" />
          <Button
            asChild
            size="sm"
            variant="primary"
            className="hidden md:inline-flex"
          >
            <Link href={NAV.cta.href}>
              {NAV.cta.label}
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </Button>
          <MobileNav />
        </div>
      </Container>
    </header>
  );
}
