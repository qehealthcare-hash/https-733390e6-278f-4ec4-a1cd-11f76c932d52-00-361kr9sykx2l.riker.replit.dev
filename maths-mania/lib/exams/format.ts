import type { ExamDifficulty, ExamPillar, ExamStatus } from "@/lib/database.types";

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function formatExamStatus(status: ExamStatus): string {
  const labels: Record<ExamStatus, string> = {
    draft: "Draft",
    scheduled: "Scheduled",
    live: "Live",
    closed: "Closed",
    merit_published: "Merit published",
    archived: "Archived",
  };
  return labels[status];
}

export function formatPillar(pillar: ExamPillar): string {
  const labels: Record<ExamPillar, string> = {
    school: "School",
    banking: "Banking",
    ssc: "SSC",
    tricks: "Tricks",
    mixed: "Mixed",
  };
  return labels[pillar];
}

export function formatDifficulty(d: ExamDifficulty): string {
  return d.charAt(0).toUpperCase() + d.slice(1);
}

/** Parse datetime-local input (no TZ) as IST wall time → UTC ISO. */
export function parseIstDatetimeLocal(value: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) return null;
  const iso = `${trimmed}:00+05:30`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Format UTC ISO for datetime-local input in IST. */
export function toIstDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function parseOptions(raw: string[]): string[] {
  return raw.map((o) => o.trim()).filter(Boolean);
}
