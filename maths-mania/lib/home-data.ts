/**
 * Home page data — mock values until Supabase (milestone 9+) and
 * YouTube API (milestone 4) wire in live sources.
 */

/** Next Sunday 11:00 AM IST — computed at module load for SSR consistency within a build. */
function nextSundayElevenIST(): Date {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  const day = istNow.getUTCDay();
  const daysUntilSunday = day === 0 ? 7 : 7 - day;
  const target = new Date(istNow);
  target.setUTCDate(istNow.getUTCDate() + (day === 0 && istNow.getUTCHours() >= 5 ? 7 : daysUntilSunday));
  target.setUTCHours(5, 30, 0, 0); // 11:00 IST = 05:30 UTC
  if (target.getTime() <= istNow.getTime()) {
    target.setUTCDate(target.getUTCDate() + 7);
  }
  return new Date(target.getTime() - istOffset);
}

export const NEXT_LIVE_EXAM = {
  slug: "ibps-quant-speed-test-2",
  title: "IBPS Quant Speed Test #2",
  startsAt: nextSundayElevenIST().toISOString(),
  registeredCount: 1847,
  durationMin: 30,
  questionCount: 20,
} as const;

export const LAST_EXAM_STATS = {
  title: "IBPS Quant Speed Test #1",
  attempts: 1847,
  topperName: "Priya R.",
  topperScore: 96.5,
  meritSlug: "ibps-quant-speed-test-1",
} as const;

export const MERIT_TOP_10 = [
  { rank: 1, name: "Priya R.", city: "Ahmedabad", score: 96.5, percentile: 99.9 },
  { rank: 2, name: "Vikram S.", city: "Bhavnagar", score: 94.0, percentile: 99.5 },
  { rank: 3, name: "Kavita D.", city: "Vadodara", score: 92.5, percentile: 99.1 },
  { rank: 4, name: "Arjun P.", city: "Rajkot", score: 91.0, percentile: 98.4 },
  { rank: 5, name: "Rahul M.", city: "Surat", score: 89.5, percentile: 97.8 },
  { rank: 6, name: "Sneha J.", city: "Gandhinagar", score: 88.0, percentile: 96.9 },
  { rank: 7, name: "Amit K.", city: "Mehsana", score: 86.5, percentile: 95.2 },
  { rank: 8, name: "Neha T.", city: "Anand", score: 85.0, percentile: 93.8 },
  { rank: 9, name: "Rohan G.", city: "Jamnagar", score: 84.0, percentile: 92.1 },
  { rank: 10, name: "Divya P.", city: "Bhuj", score: 83.5, percentile: 90.5 },
] as const;

export const TRUST_CHIPS = [
  "CBSE",
  "Gujarat Board",
  "IBPS",
  "SSC CGL",
  "SBI PO",
] as const;

export const TRICKS = [
  {
    id: "multiply-11",
    title: "Multiply any 2-digit number by 11",
    latex: "34 \\times 11 = 374",
    explanation:
      "Split the digits: write the first digit, add them in the middle, write the last digit. If the sum is 10+, carry the 1.",
    example: "34 → 3, (3+4), 4 → 374",
    href: "/blog/multiply-by-11",
  },
  {
    id: "square-5",
    title: "Square any number ending in 5",
    latex: "65^2 = 4225",
    explanation:
      "Take the tens digit n. Answer is n×(n+1) followed by 25.",
    example: "6×7 = 42 → append 25 → 4225",
    href: "/blog/square-ending-in-5",
  },
  {
    id: "percent-flip",
    title: "Flip percentages mentally",
    latex: "16\\frac{2}{3}\\% \\text{ of } 90 = 90 \\text{ of } 16\\frac{2}{3}\\% = 15",
    explanation:
      "x% of y = y% of x. Pick the easier side to calculate.",
    example: "16⅔% of 90 = 90 of 16⅔% = 15",
    href: "/blog",
  },
] as const;

export const RESOURCES_PREVIEW = [
  {
    id: "formula-10",
    title: "Class 10 Formula Sheet",
    pages: 12,
    size: "1.4 MB",
    href: "/resources?type=formula",
  },
  {
    id: "banking-cheat",
    title: "Banking Quant Cheatsheet",
    pages: 8,
    size: "980 KB",
    href: "/resources?type=cheatsheet",
  },
  {
    id: "ssc-analysis",
    title: "SSC CGL Quant Analysis 2025",
    pages: 24,
    size: "2.1 MB",
    href: "/resources?type=previous-year",
  },
  {
    id: "vedic-starter",
    title: "Vedic Maths Starter Pack",
    pages: 6,
    size: "720 KB",
    href: "/resources?type=revision",
  },
] as const;

/** Placeholder videos until YouTube API (milestone 4). */
export const PLACEHOLDER_VIDEOS = [
  {
    id: "v1",
    title: "Percentage in 15 Minutes — Banking Prelims Must-Know",
    publishedAt: "2026-05-24T10:00:00Z",
    duration: "14:22",
    thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    viewCount: "42K",
  },
  {
    id: "v2",
    title: "Class 10 Trigonometry — 3 Identities You Must Memorise",
    publishedAt: "2026-05-21T10:00:00Z",
    duration: "18:05",
    thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    viewCount: "38K",
  },
  {
    id: "v3",
    title: "Multiply by 11 in One Second — SSC & Banking",
    publishedAt: "2026-05-18T10:00:00Z",
    duration: "9:41",
    thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    viewCount: "61K",
  },
  {
    id: "v4",
    title: "DI Table Chart Pattern — IBPS PO 2025",
    publishedAt: "2026-05-15T10:00:00Z",
    duration: "22:18",
    thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    viewCount: "29K",
  },
  {
    id: "v5",
    title: "Square of Numbers Ending in 5 — Vedic Trick",
    publishedAt: "2026-05-12T10:00:00Z",
    duration: "11:33",
    thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    viewCount: "55K",
  },
  {
    id: "v6",
    title: "Time & Work — LCM Method for SSC CGL",
    publishedAt: "2026-05-09T10:00:00Z",
    duration: "16:50",
    thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    viewCount: "33K",
  },
] as const;
