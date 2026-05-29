import type { Metadata } from "next";
import { SITE } from "@/lib/site";

export const NOINDEX_ROBOTS: Metadata["robots"] = {
  index: false,
  follow: false,
  googleBot: { index: false, follow: false },
};

/** Absolute URL for a site path (always uses SITE.url / metadataBase). */
export function pageUrl(path = "/"): string {
  const base = SITE.url.replace(/\/$/, "");
  if (!path || path === "/") return `${base}/`;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}

export function createPageMetadata(options: {
  title: string;
  description: string;
  /** Path without domain, e.g. `/exams` or `/blog/my-post`. */
  path: string;
  noIndex?: boolean;
  ogType?: "website" | "article";
}): Metadata {
  const url = pageUrl(options.path);
  const ogImage = pageUrl("/brand/og-image.png");

  return {
    title: options.title,
    description: options.description,
    alternates: { canonical: url },
    openGraph: {
      title: options.title,
      description: options.description,
      url,
      type: options.ogType === "article" ? "article" : "website",
      siteName: SITE.name,
      locale: SITE.locale,
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: `${SITE.name} — ${SITE.tagline}`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: options.title,
      description: options.description,
      images: [ogImage],
    },
    ...(options.noIndex ? { robots: NOINDEX_ROBOTS } : {}),
  };
}

export type BreadcrumbItem = {
  name: string;
  href?: string;
};

export function breadcrumbListSchema(items: BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      ...(item.href ? { item: pageUrl(item.href) } : {}),
    })),
  };
}

export function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "EducationalOrganization",
    name: SITE.name,
    url: SITE.url,
    description: SITE.shortDescription,
    email: SITE.email,
    areaServed: { "@type": "Country", name: SITE.country },
    sameAs: [
      SITE.social.youtube,
      SITE.social.instagram,
      SITE.social.facebook,
    ].filter(Boolean),
  };
}

export function websiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE.name,
    url: SITE.url,
    description: SITE.shortDescription,
    inLanguage: SITE.locale,
    publisher: { "@type": "Organization", name: SITE.name, url: SITE.url },
  };
}

export function courseSchema(options: {
  name: string;
  description: string;
  path: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Course",
    name: options.name,
    description: options.description,
    url: pageUrl(options.path),
    provider: { "@type": "Organization", name: SITE.name, url: SITE.url },
    inLanguage: SITE.locale,
    isAccessibleForFree: true,
  };
}

export function examEventSchema(options: {
  name: string;
  description: string;
  path: string;
  startsAt: string;
  endsAt: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: options.name,
    description: options.description,
    url: pageUrl(options.path),
    startDate: options.startsAt,
    endDate: options.endsAt,
    eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
    eventStatus: "https://schema.org/EventScheduled",
    location: {
      "@type": "VirtualLocation",
      url: pageUrl(options.path),
    },
    organizer: { "@type": "Organization", name: SITE.name, url: SITE.url },
    isAccessibleForFree: true,
  };
}

/** Paths included in the public sitemap (marketing + content). */
export const STATIC_SITEMAP_PATHS = [
  "/",
  "/exams",
  "/courses",
  "/videos",
  "/resources",
  "/blog",
  "/quiz",
  "/testimonials",
  "/about",
  "/contact",
  "/privacy",
  "/terms",
  "/certificates/verify",
] as const;
