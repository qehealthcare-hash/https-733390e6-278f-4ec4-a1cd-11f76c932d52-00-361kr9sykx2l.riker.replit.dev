import Link from "next/link";
import { MapPin } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Logo } from "@/components/brand/logo";
import {
  YoutubeIcon,
  InstagramIcon,
  FacebookIcon,
  WhatsappIcon,
} from "@/components/brand/social-icons";
import { SITE, NAV } from "@/lib/site";
import { cn } from "@/lib/utils";

/**
 * Footer
 *
 * Four-column on desktop, stacks on mobile. Each column comes from
 * NAV.footer in lib/site.ts so adding a link doesn't require editing
 * the footer markup. The legal bottom bar carries the brand mark, the
 * "Made in Ahmedabad" tagline, and the small π glyph.
 */
export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text)]">
      <Container className="py-14 sm:py-16">
        <div className="grid gap-10 md:grid-cols-12">
          {/* Brand column */}
          <div className="md:col-span-4">
            <Logo withTagline />
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-[var(--color-text-muted)]">
              {SITE.shortDescription}
            </p>

            <div className="mt-6 flex items-center gap-1">
              <SocialIcon
                href={SITE.social.youtube}
                label="YouTube"
                icon={<YoutubeIcon width={16} height={16} />}
              />
              <SocialIcon
                href={SITE.social.instagram}
                label="Instagram"
                icon={<InstagramIcon width={16} height={16} />}
              />
              <SocialIcon
                href={SITE.social.facebook}
                label="Facebook"
                icon={<FacebookIcon width={16} height={16} />}
              />
              {SITE.social.whatsapp && (
                <SocialIcon
                  href={`https://wa.me/${SITE.social.whatsapp.replace(/\D/g, "")}`}
                  label="WhatsApp"
                  icon={<WhatsappIcon width={16} height={16} />}
                />
              )}
            </div>

            <p className="mt-6 inline-flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
              <MapPin className="size-3.5" aria-hidden />
              <span>
                {SITE.city}, {SITE.country}
              </span>
            </p>
          </div>

          {/* Link columns */}
          <div className="grid grid-cols-2 gap-8 md:col-span-8 md:grid-cols-4">
            <FooterColumn
              title={NAV.footer.learn.title}
              items={NAV.footer.learn.items}
            />
            <FooterColumn
              title={NAV.footer.compete.title}
              items={NAV.footer.compete.items}
            />
            <FooterColumn
              title={NAV.footer.resources.title}
              items={NAV.footer.resources.items}
            />
            <FooterColumn
              title={NAV.footer.company.title}
              items={NAV.footer.company.items}
            />
          </div>
        </div>
      </Container>

      {/* Legal bottom bar */}
      <div className="border-t border-[var(--color-border)]">
        <Container className="flex flex-col gap-3 py-5 text-xs text-[var(--color-text-muted)] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <PiGlyph />
            <span>
              © {year} {SITE.name} · {SITE.tagline}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/privacy"
              className="hover:text-[var(--color-text)]"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="hover:text-[var(--color-text)]"
            >
              Terms
            </Link>
            <span
              className="font-mono text-[10px] uppercase tracking-wider"
              aria-hidden
            >
              v0.1.0
            </span>
          </div>
        </Container>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  items,
}: {
  title: string;
  items: readonly { href: string; label: string }[];
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
        {title}
      </h3>
      <ul className="mt-4 flex flex-col gap-2.5">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="text-sm text-[var(--color-text)] transition-colors hover:text-[var(--color-primary-600)]"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SocialIcon({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-full",
        "text-[var(--color-text-muted)] transition-colors",
        "hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]",
      )}
    >
      {icon}
    </a>
  );
}

/**
 * Small editorial π mark used in the legal bar.
 */
function PiGlyph() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      className="text-[var(--color-primary-500)]"
    >
      <path
        d="M3 8 H21 M9 8 V18 M16 8 V16 Q16 18 18 18"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
