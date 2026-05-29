"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, ArrowRight } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  YoutubeIcon,
  InstagramIcon,
  FacebookIcon,
  WhatsappIcon,
} from "@/components/brand/social-icons";
import { NAV, SITE } from "@/lib/site";
import { cn } from "@/lib/utils";

/**
 * MobileNav — full-screen drawer triggered by the hamburger.
 *
 * Built on Radix Dialog for: focus trap, ESC handling, body-scroll lock,
 * inert background, aria-modal labelling. Slides in from the right.
 * Auto-closes on route change so back-button feels natural.
 */
export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  // Auto-close on route change. We compare the previous pathname inside
  // a ref so we don't fire on the initial mount (which would close-on-open).
  const prevPath = React.useRef(pathname);
  React.useEffect(() => {
    if (prevPath.current !== pathname) {
      setOpen(false);
      prevPath.current = pathname;
    }
  }, [pathname]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="Open menu"
          className="inline-flex size-10 items-center justify-center rounded-full text-[var(--color-text)] hover:bg-[var(--color-surface-alt)] lg:hidden"
        >
          <Menu className="size-5" aria-hidden />
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-[var(--color-neutral-900)]/40 backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          )}
          style={{ animationDuration: "200ms" }}
        />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col",
            "border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl",
            "data-[state=open]:animate-in data-[state=open]:slide-in-from-right",
            "data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right",
            "focus:outline-none",
          )}
          style={{
            // Manual animation since we don't have tailwindcss-animate yet.
            animationDuration: "240ms",
            animationTimingFunction: "var(--ease-out-quad)",
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
            <Dialog.Title asChild>
              <span>
                <Logo />
              </span>
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close menu"
                className="inline-flex size-10 items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)]"
              >
                <X className="size-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          {/* Nav links */}
          <nav
            aria-label="Mobile primary"
            className="flex-1 overflow-y-auto px-3 py-4"
          >
            <ul className="flex flex-col gap-0.5">
              {NAV.primary.map((item) => {
                const active = pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href));
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex flex-col gap-0.5 rounded-[var(--radius-md)] px-4 py-3",
                        active
                          ? "bg-[var(--color-primary-50)] text-[var(--color-primary-700)] dark:bg-[var(--color-primary-900)]/30 dark:text-[var(--color-primary-200)]"
                          : "text-[var(--color-text)] hover:bg-[var(--color-surface-alt)]",
                      )}
                    >
                      <span className="text-base font-semibold">{item.label}</span>
                      {item.description && (
                        <span className="text-xs text-[var(--color-text-muted)]">
                          {item.description}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>

            {/* CTA */}
            <div className="mt-6 px-4">
              <Button asChild size="lg" variant="primary" className="w-full">
                <Link href={NAV.cta.href}>
                  {NAV.cta.label}
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
            </div>
          </nav>

          {/* Footer: theme + socials */}
          <div className="border-t border-[var(--color-border)] px-5 py-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                Theme
              </span>
              <ThemeToggle />
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                Follow
              </span>
              <div className="flex items-center gap-1">
                <SocialLink href={SITE.social.youtube} icon={<YoutubeIcon width={16} height={16} />} label="YouTube" />
                <SocialLink href={SITE.social.instagram} icon={<InstagramIcon width={16} height={16} />} label="Instagram" />
                <SocialLink href={SITE.social.facebook} icon={<FacebookIcon width={16} height={16} />} label="Facebook" />
                {SITE.social.whatsapp && (
                  <SocialLink
                    href={`https://wa.me/${SITE.social.whatsapp.replace(/\D/g, "")}`}
                    icon={<WhatsappIcon width={16} height={16} />}
                    label="WhatsApp"
                  />
                )}
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SocialLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="inline-flex size-9 items-center justify-center rounded-full text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)]"
    >
      {icon}
    </a>
  );
}
