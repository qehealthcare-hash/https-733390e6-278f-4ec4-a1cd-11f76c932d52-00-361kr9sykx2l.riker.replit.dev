/**
 * Single source of truth for site-wide constants.
 * Anything that appears on multiple pages or in metadata
 * should live here, not be re-typed in components.
 */

export const SITE = {
  name: "Maths Mania",
  tagline: "Beyond Numbers, Your Way to Learn",
  shortDescription:
    "From Class 1 fundamentals to SSC and Banking aptitude — step-by-step methods, smart shortcuts, and real-time mock exams with an All-India merit list.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://mathsmania.in",
  locale: "en-IN",
  timezone: "Asia/Kolkata",
  city: "Ahmedabad",
  country: "India",
  founded: 2024,
  email: "hi@mathsmania.in",

  social: {
    youtube:
      process.env.NEXT_PUBLIC_CHANNEL_URL ??
      "https://www.youtube.com/channel/UCbPBJROEaXpSryqgrcybufA",
    instagram:
      process.env.NEXT_PUBLIC_INSTAGRAM_URL ??
      "https://www.instagram.com/mathsmaniaa/",
    facebook:
      process.env.NEXT_PUBLIC_FACEBOOK_URL ??
      "https://www.facebook.com/profile.php?id=61589172945959",
    whatsapp: process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "",
  },

  pillars: [
    {
      slug: "school",
      label: "School Maths",
      shortLabel: "School",
      tag: "Class 1–10",
      blurb:
        "CBSE, Gujarat Board and state-board friendly. Build the fundamentals that every later exam quietly assumes you have.",
      accent: "primary",
      icon: "school",
    },
    {
      slug: "banking",
      label: "Banking Quant",
      shortLabel: "Banking",
      tag: "IBPS · SBI · RBI",
      blurb:
        "Speed maths for PO/Clerk prelims and mains. DI patterns, simplification chains and the arithmetic you'll see in the actual paper.",
      accent: "secondary",
      icon: "wallet",
    },
    {
      slug: "ssc",
      label: "SSC & Aptitude",
      shortLabel: "SSC",
      tag: "CGL · CHSL · MTS · Railways",
      blurb:
        "Quantitative aptitude focused on SSC's quirks: trigonometry, geometry, advanced arithmetic. Last 5 years' patterns unpacked.",
      accent: "secondary",
      icon: "target",
    },
    {
      slug: "tricks",
      label: "Smart Tricks",
      shortLabel: "Tricks",
      tag: "Vedic · speed maths",
      blurb:
        "Shortcuts that survive the exam hall — squares ending in 5, multiplication by 11, percentage flips. The actual aha moments.",
      accent: "accent",
      icon: "sparkles",
    },
    {
      slug: "exams",
      label: "Real-Time Exams",
      shortLabel: "Live Exams",
      tag: "All-India merit list",
      blurb:
        "Free 30-minute live mocks every Sunday. Synchronized start across India. Auto-graded. Merit list within an hour. Certificates for top 10%.",
      accent: "primary",
      icon: "trophy",
      flagship: true,
    },
  ] as const,
} as const;

export type Pillar = (typeof SITE.pillars)[number];
export type PillarSlug = Pillar["slug"];

// ──────────────────────────────────────────────────────────
// Navigation structure — single source of truth for navbar + footer.
// Anything in NAV.primary appears in the top navbar on desktop.
// Items with `cta: true` get rendered as a primary button.
// ──────────────────────────────────────────────────────────

export type NavItem = {
  label: string;
  href: string;
  external?: boolean;
  description?: string;
  /** Treat as the primary CTA — rendered as a brand-red button. */
  cta?: boolean;
};

export const NAV = {
  primary: [
    { label: "Live Exams", href: "/exams", description: "Free synchronized All-India mocks every week" },
    { label: "Courses", href: "/courses", description: "Five tracks: school, banking, SSC, tricks, exams" },
    { label: "Videos", href: "/videos", description: "Everything from the YouTube channel" },
    { label: "Resources", href: "/resources", description: "Free PDFs, formula sheets, cheat sheets" },
    { label: "Blog", href: "/blog", description: "Smart maths tricks, breakdowns and exam strategy" },
    { label: "About", href: "/about", description: "Our story and teaching philosophy" },
  ] as readonly NavItem[],

  /** Renders as the brand-red CTA on the right of the navbar. */
  cta: {
    label: "Reserve seat",
    href: "/exams",
    cta: true,
  } satisfies NavItem,

  footer: {
    learn: {
      title: "Learn",
      items: [
        { label: "School Maths", href: "/courses/school" },
        { label: "Banking Quant", href: "/courses/banking" },
        { label: "SSC & Aptitude", href: "/courses/ssc" },
        { label: "Smart Tricks", href: "/courses/tricks" },
        { label: "Live Exams", href: "/courses/exams" },
      ] as readonly NavItem[],
    },
    compete: {
      title: "Compete",
      items: [
        { label: "Upcoming Exams", href: "/exams" },
        { label: "Past Results", href: "/exams?tab=past" },
        { label: "Merit Lists", href: "/exams?tab=merit" },
        { label: "My Dashboard", href: "/dashboard" },
        { label: "Certificate verify", href: "/certificates/verify" },
      ] as readonly NavItem[],
    },
    resources: {
      title: "Resources",
      items: [
        { label: "Free Notes & PDFs", href: "/resources" },
        { label: "Practice Quiz", href: "/quiz" },
        { label: "Maths Tricks Blog", href: "/blog" },
        { label: "Formula Sheets", href: "/resources?type=formula" },
        { label: "Testimonials", href: "/testimonials" },
      ] as readonly NavItem[],
    },
    company: {
      title: "Company",
      items: [
        { label: "About", href: "/about" },
        { label: "Contact", href: "/contact" },
        { label: "Privacy Policy", href: "/privacy" },
        { label: "Terms of Service", href: "/terms" },
      ] as readonly NavItem[],
    },
  },
} as const;

export type NavSection = keyof typeof NAV.footer;

