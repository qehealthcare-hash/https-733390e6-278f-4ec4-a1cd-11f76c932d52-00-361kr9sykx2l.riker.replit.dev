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
