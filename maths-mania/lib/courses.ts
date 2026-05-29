import { SITE, type PillarSlug } from "@/lib/site";

export type SyllabusChapter = {
  title: string;
  topics: string[];
};

export type CourseDownload = {
  id: string;
  title: string;
  description: string;
  href: string;
  pages?: number;
};

export type CourseFaq = {
  id: string;
  question: string;
  answer: string;
};

export type RecommendedVideo = {
  order: number;
  title: string;
  note: string;
};

export type CourseDetail = {
  slug: PillarSlug;
  metaTitle: string;
  metaDescription: string;
  heroEyebrow: string;
  heroTitle: string;
  heroSubtitle: string;
  /** Env var name for YouTube playlist embed (without NEXT_PUBLIC_ prefix in lookup). */
  playlistEnvKey?:
    | "PLAYLIST_SCHOOL"
    | "PLAYLIST_BANKING"
    | "PLAYLIST_SSC"
    | "PLAYLIST_TRICKS";
  syllabus: SyllabusChapter[];
  recommendedVideos: RecommendedVideo[];
  downloads: CourseDownload[];
  faqs: CourseFaq[];
  primaryCta: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
  stat: string;
};

const COURSES: Record<PillarSlug, CourseDetail> = {
  school: {
    slug: "school",
    metaTitle: "School Maths — Class 1 to 10",
    metaDescription:
      "CBSE, Gujarat Board and state-board maths from Class 1 to 10. Step-by-step fundamentals that boards actually test.",
    heroEyebrow: "Class 1–10 · CBSE · Gujarat Board",
    heroTitle: "School maths that finally sticks",
    heroSubtitle:
      "Boards don't test tricks — they test clarity. We build concepts chapter by chapter so Class 10 doesn't feel like a surprise.",
    playlistEnvKey: "PLAYLIST_SCHOOL",
    stat: "12,000+ school students on the channel",
    syllabus: [
      {
        title: "Class 6–8 — Foundations",
        topics: [
          "Number systems & BODMAS",
          "Fractions, decimals, percentages",
          "Algebraic expressions basics",
          "Geometry: lines, angles, triangles",
          "Mensuration introduction",
        ],
      },
      {
        title: "Class 9 — Algebra & geometry ramp-up",
        topics: [
          "Polynomials & factorisation",
          "Linear equations in two variables",
          "Coordinate geometry basics",
          "Circles & constructions",
          "Statistics & probability intro",
        ],
      },
      {
        title: "Class 10 — Board exam focus",
        topics: [
          "Real numbers & polynomials",
          "Pair of linear equations",
          "Quadratic equations",
          "Arithmetic progressions",
          "Trigonometry (ratios, identities, heights)",
          "Coordinate geometry & areas",
          "Surface areas & volumes",
          "Statistics & probability",
        ],
      },
    ],
    recommendedVideos: [
      { order: 1, title: "Real numbers — Euclid's division lemma", note: "Start here for boards" },
      { order: 2, title: "Trigonometry: the 3 identities you must memorise", note: "High-weightage chapter" },
      { order: 3, title: "Quadratic equations — factorisation vs formula", note: "When to use which" },
      { order: 4, title: "Surface area & volume — one formula sheet", note: "Revision before pre-boards" },
    ],
    downloads: [
      {
        id: "formula-10",
        title: "Class 10 Formula Sheet",
        description: "Algebra, trig, geometry, mensuration — one PDF.",
        href: "/resources?type=formula",
        pages: 12,
      },
      {
        id: "identity-sheet",
        title: "Trigonometry Identity Cheat Sheet",
        description: "All identities with one worked example each.",
        href: "/resources",
        pages: 4,
      },
    ],
    faqs: [
      {
        id: "boards",
        question: "Do you cover Gujarat Board specifically?",
        answer:
          "Yes. We're Ahmedabad-based and many of our Class 10 students are Gujarat Board. The methods work across boards; we flag Gujarat-specific question styles where they differ from CBSE.",
      },
      {
        id: "class",
        question: "Which class should I start from on the channel?",
        answer:
          "Pick your current class playlist or search the chapter name. If you're in Class 10 boards year, follow the Class 10 track in order — don't jump to tricks before fundamentals are clear.",
      },
      {
        id: "ncert",
        question: "Is this aligned with NCERT?",
        answer:
          "Yes. Our chapter order follows NCERT/CBSE progression. Gujarat Board chapters map closely; we mention alternate naming when it differs.",
      },
    ],
    primaryCta: {
      label: "Try Class 10 practice quiz",
      href: "/quiz/class-10-trigonometry",
    },
    secondaryCta: { label: "Watch all school videos", href: "/videos" },
  },

  banking: {
    slug: "banking",
    metaTitle: "Banking Quant — IBPS, SBI, RBI",
    metaDescription:
      "Quantitative aptitude for IBPS PO/Clerk, SBI PO/Clerk, RBI Grade B. Simplification, DI, arithmetic — at exam speed.",
    heroEyebrow: "IBPS · SBI · RBI · NABARD",
    heroTitle: "Banking quant without the panic",
    heroSubtitle:
      "Prelims need speed. Mains need accuracy on DI. We teach both — with patterns from the last five years of papers.",
    playlistEnvKey: "PLAYLIST_BANKING",
    stat: "8,500+ banking aspirants helped",
    syllabus: [
      {
        title: "Prelims arithmetic",
        topics: [
          "Simplification & approximation",
          "Number series",
          "Quadratic equations (comparison)",
          "Ratio, percentage, average",
          "Profit & loss, SI/CI",
          "Time & work, pipes & cisterns",
        ],
      },
      {
        title: "Data interpretation",
        topics: [
          "Table charts",
          "Bar & line graphs",
          "Pie charts",
          "Caselets (missing data)",
          "Mixed DI sets",
        ],
      },
      {
        title: "Mains-level topics",
        topics: [
          "Partnership & mixtures",
          "Permutation & combination basics",
          "Probability for banking",
          "Mensuration for DI",
        ],
      },
    ],
    recommendedVideos: [
      { order: 1, title: "Simplification — order of operations at speed", note: "Prelims foundation" },
      { order: 2, title: "Percentage in 15 minutes", note: "Must-know for every paper" },
      { order: 3, title: "5 high-frequency DI patterns in 2025", note: "Mains focus" },
      { order: 4, title: "Number series — missing & wrong number", note: "5 questions every prelims" },
    ],
    downloads: [
      {
        id: "banking-cheat",
        title: "Banking Quant Cheatsheet",
        description: "Formulas + common traps for PO/Clerk prelims.",
        href: "/resources",
        pages: 8,
      },
      {
        id: "di-patterns",
        title: "DI Pattern Quick Reference",
        description: "Table, bar, pie, caselet — when to use which approach.",
        href: "/resources",
        pages: 6,
      },
    ],
    faqs: [
      {
        id: "ibps-sbi",
        question: "Is this enough for both IBPS and SBI?",
        answer:
          "Yes. The quant syllabus overlaps heavily. We call out SBI-specific quirks (slightly harder DI in some years) in relevant videos.",
      },
      {
        id: "pre-mains",
        question: "Prelims or mains first?",
        answer:
          "Master prelims arithmetic + basic DI first. Add mains-level partnership/mixture only after you're consistently scoring 25+ in quant prelims mocks.",
      },
      {
        id: "calculator",
        question: "Can I use rough work in the exam?",
        answer:
          "Yes — we teach methods that minimise rough work but don't ban it. Speed comes from pattern recognition, not skipping steps blindly.",
      },
    ],
    primaryCta: {
      label: "Take IBPS quant mock quiz",
      href: "/quiz/ibps-quant-mock",
    },
    secondaryCta: { label: "Register for live banking mock", href: "/exams" },
  },

  ssc: {
    slug: "ssc",
    metaTitle: "SSC & Competitive Aptitude",
    metaDescription:
      "SSC CGL, CHSL, MTS, Railways quant. Trigonometry, geometry, advanced arithmetic — taught for SSC's actual paper style.",
    heroEyebrow: "CGL · CHSL · MTS · Railways",
    heroTitle: "SSC quant with the right weightage",
    heroSubtitle:
      "SSC doesn't reward random practice. We focus on chapters that carry marks every year — and skip the noise.",
    playlistEnvKey: "PLAYLIST_SSC",
    stat: "6,200+ SSC aspirants on live mocks",
    syllabus: [
      {
        title: "Arithmetic (Tier I heavy)",
        topics: [
          "Percentage, ratio, partnership",
          "Profit & loss, discount",
          "Time & work, wages",
          "Speed, time & distance",
          "SI/CI, instalments",
          "Mixture & allegation",
        ],
      },
      {
        title: "Advanced maths (Tier II)",
        topics: [
          "Trigonometry — identities & heights",
          "Geometry — triangles, circles, quadrilaterals",
          "Mensuration 2D & 3D",
          "Algebra — polynomials, linear equations",
          "Coordinate geometry",
        ],
      },
      {
        title: "Exam strategy",
        topics: [
          "Topic-wise weightage (last 5 years)",
          "Which questions to skip in the hall",
          "Accuracy vs attempt strategy",
        ],
      },
    ],
    recommendedVideos: [
      { order: 1, title: "Time & Work — LCM method", note: "Tier I staple" },
      { order: 2, title: "Trigonometry identities — only what SSC asks", note: "Tier II" },
      { order: 3, title: "Geometry: similar triangles shortcut", note: "High frequency" },
      { order: 4, title: "Percentage — one-line conversions", note: "Cross-tier" },
    ],
    downloads: [
      {
        id: "ssc-analysis",
        title: "SSC CGL Quant Analysis 2025",
        description: "Chapter weightage from recent papers.",
        href: "/resources",
        pages: 24,
      },
    ],
    faqs: [
      {
        id: "tier",
        question: "Tier I vs Tier II — same playlist?",
        answer:
          "Start with Tier I arithmetic. Add advanced maths videos when Tier I mocks are stable. The syllabus page above splits them clearly.",
      },
      {
        id: "pattern",
        question: "Will SSC 2026 pattern change?",
        answer:
          "We update when the commission notifies. Current mocks follow the latest known pattern; live exams on this site announce any changes in the rules tab.",
      },
    ],
    primaryCta: {
      label: "SSC CGL percentage quiz",
      href: "/quiz/ssc-cgl-percentages",
    },
    secondaryCta: { label: "Join Sunday live mock", href: "/exams" },
  },

  tricks: {
    slug: "tricks",
    metaTitle: "Smart Tricks & Vedic Maths",
    metaDescription:
      "Speed maths, Vedic tricks, mental calculation — shortcuts that work under exam time pressure, not just for show.",
    heroEyebrow: "Vedic · speed maths · mental math",
    heroTitle: "Shortcuts that survive the exam hall",
    heroSubtitle:
      "A trick you can't use under pressure isn't a trick — it's a reel. We only teach methods we'd use ourselves in a timed paper.",
    playlistEnvKey: "PLAYLIST_TRICKS",
    stat: "Most-shared section on the channel",
    syllabus: [
      {
        title: "Multiplication & division",
        topics: [
          "Multiply by 11, 12, 15",
          "Two-digit × two-digit (verbal method)",
          "Division by 5, 25, 125",
          "Digital root checks",
        ],
      },
      {
        title: "Squares & roots",
        topics: [
          "Squares ending in 5",
          "Near-base squaring (above/below 50, 100)",
          "Square roots of perfect squares",
          "Cube roots of perfect cubes",
        ],
      },
      {
        title: "Percentages & fractions",
        topics: [
          "Flip rule (x% of y = y% of x)",
          "Successive percentage change",
          "Fraction to percentage mental map",
        ],
      },
    ],
    recommendedVideos: [
      { order: 1, title: "Multiply any 2-digit number by 11", note: "30-second mastery" },
      { order: 2, title: "Square of numbers ending in 5", note: "Banking + SSC" },
      { order: 3, title: "Vedic maths starter — 12 tricks", note: "Pick 3 for this week" },
    ],
    downloads: [
      {
        id: "vedic-starter",
        title: "Vedic Maths Starter Pack",
        description: "12 tricks with practice drills.",
        href: "/resources",
        pages: 6,
      },
    ],
    faqs: [
      {
        id: "foundation",
        question: "Should beginners start with tricks?",
        answer:
          "No. Learn the standard method first for a chapter, then add the trick. Tricks without fundamentals break down on unfamiliar numbers.",
      },
      {
        id: "boards",
        question: "Are tricks allowed in board exams?",
        answer:
          "You must show acceptable working. Tricks help you compute faster; still write steps the examiner expects for method marks.",
      },
    ],
    primaryCta: { label: "Read tricks on the blog", href: "/blog?tag=tricks" },
    secondaryCta: { label: "Practice quiz", href: "/quiz" },
  },

  exams: {
    slug: "exams",
    metaTitle: "Real-Time Live Exams",
    metaDescription:
      "Free synchronized All-India mock exams every Sunday. Auto-graded, ranked, merit list within an hour.",
    heroEyebrow: "All-India · Live · Ranked",
    heroTitle: "Prove it on a real All-India paper",
    heroSubtitle:
      "Same start time. Same questions. Real rank. Not a PDF mock you attempt alone — a live event the whole country writes together.",
    stat: "1,800+ attempts every Sunday",
    syllabus: [
      {
        title: "Upcoming exam formats",
        topics: [
          "IBPS Quant Speed Test — 30 min, 20 Q",
          "SSC CGL Quant Diagnostic — 20 min, 15 Q",
          "Class 10 Board Revision Mock — 45 min",
          "Banking DI Special — 25 min",
        ],
      },
      {
        title: "What you get after each exam",
        topics: [
          "Instant personal scorecard",
          "Topic-wise accuracy breakdown",
          "All-India rank & percentile",
          "Answer key with explanations",
          "Certificate for top 10%",
        ],
      },
      {
        title: "Rules (summary)",
        topics: [
          "Register before the window closes",
          "Enter lobby 60 minutes early",
          "One attempt per student",
          "Anti-cheat: tab switch warnings, auto-submit at 3 violations",
          "Tie-break: higher score, then earlier submission",
        ],
      },
    ],
    recommendedVideos: [
      { order: 1, title: "How to attempt a live mock — strategy", note: "Watch before your first exam" },
      { order: 2, title: "Time management: 60 questions in 60 minutes", note: "Pacing framework" },
    ],
    downloads: [],
    faqs: [
      {
        id: "free",
        question: "Is every live exam free?",
        answer: "Yes in v1. Registration is free; you need an account to get a rank on the merit list.",
      },
      {
        id: "device",
        question: "Phone or laptop?",
        answer:
          "Both work. Laptop is easier for the question palette. Phone is fully supported — use fullscreen when prompted.",
      },
      {
        id: "merit",
        question: "When is the merit list published?",
        answer:
          "Within about 60 minutes of the exam window closing. You'll get an email when your rank is live.",
      },
    ],
    primaryCta: { label: "View upcoming exams", href: "/exams" },
    secondaryCta: { label: "See last merit list", href: "/exams?tab=merit" },
  },
};

export function getCourse(slug: string): CourseDetail | undefined {
  if (slug in COURSES) {
    return COURSES[slug as PillarSlug];
  }
  return undefined;
}

export function getAllCourseSlugs(): PillarSlug[] {
  return SITE.pillars.map((p) => p.slug);
}

export function getPillarFromSite(slug: PillarSlug) {
  return SITE.pillars.find((p) => p.slug === slug)!;
}

/** Resolve YouTube playlist ID from env for embed. */
export function getPlaylistId(
  key: CourseDetail["playlistEnvKey"],
): string | undefined {
  if (!key) return undefined;
  const map: Record<NonNullable<CourseDetail["playlistEnvKey"]>, string | undefined> = {
    PLAYLIST_SCHOOL: process.env.NEXT_PUBLIC_PLAYLIST_SCHOOL,
    PLAYLIST_BANKING: process.env.NEXT_PUBLIC_PLAYLIST_BANKING,
    PLAYLIST_SSC: process.env.NEXT_PUBLIC_PLAYLIST_SSC,
    PLAYLIST_TRICKS: process.env.NEXT_PUBLIC_PLAYLIST_TRICKS,
  };
  const id = map[key]?.trim();
  return id || undefined;
}

/** Comparison table for /courses hub. */
export const COURSE_COMPARISON = [
  { feature: "Live All-India rank", school: "—", banking: "✓", ssc: "✓", tricks: "—", exams: "✓" },
  { feature: "Board exam focus", school: "✓", banking: "—", ssc: "—", tricks: "—", exams: "—" },
  { feature: "DI & data interpretation", school: "—", banking: "✓", ssc: "✓", tricks: "—", exams: "✓" },
  { feature: "Speed tricks", school: "Basic", banking: "✓", ssc: "✓", tricks: "✓✓", exams: "—" },
  { feature: "Free YouTube lessons", school: "✓", banking: "✓", ssc: "✓", tricks: "✓", exams: "—" },
  { feature: "Scheduled live mock", school: "—", banking: "✓", ssc: "✓", tricks: "—", exams: "✓✓" },
] as const;

export const ACCENT_STYLES: Record<
  PillarSlug,
  { border: string; bg: string; text: string }
> = {
  school: {
    border: "border-[var(--color-primary-200)]",
    bg: "from-[var(--color-primary-50)] to-[var(--color-surface)]",
    text: "text-[var(--color-primary-600)]",
  },
  banking: {
    border: "border-[var(--color-secondary-100)]",
    bg: "from-[var(--color-surface-alt)] to-[var(--color-surface)]",
    text: "text-[var(--color-secondary-600)]",
  },
  ssc: {
    border: "border-[var(--color-secondary-100)]",
    bg: "from-[var(--color-surface-alt)] to-[var(--color-surface)]",
    text: "text-[var(--color-secondary-600)]",
  },
  tricks: {
    border: "border-[var(--color-accent-300)]",
    bg: "from-[var(--color-accent-100)] to-[var(--color-surface)]",
    text: "text-[var(--color-neutral-800)]",
  },
  exams: {
    border: "border-[var(--color-primary-300)]",
    bg: "from-[var(--color-primary-100)] to-[var(--color-surface)]",
    text: "text-[var(--color-primary-700)]",
  },
};
