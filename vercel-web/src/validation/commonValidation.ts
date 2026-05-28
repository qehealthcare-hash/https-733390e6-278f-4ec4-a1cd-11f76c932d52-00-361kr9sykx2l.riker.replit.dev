import { z } from "zod";

export const phoneSchema = z
  .string()
  .trim()
  .min(7, "Phone too short")
  .max(20, "Phone too long")
  .regex(/^[0-9+\-\s()]+$/i, "Invalid phone characters")
  .transform((p) => p.replace(/[^0-9+]/g, ""));

export const emailSchema = z.string().trim().email().transform((e) => e.toLowerCase());

/**
 * Lenient email field that is safe to round-trip from a GET response into a
 * PATCH body. Accepts:
 *  - undefined / null  -> ""
 *  - empty / whitespace-only strings -> ""
 *  - real email strings -> lowercased trimmed value (validated)
 *
 * Use this on *all* input schemas the UI hits, because the React forms
 * load the full row, mutate one field, and POST/PATCH the same body back.
 */
export const optionalEmail = z
  .preprocess(
    (v) => (v == null ? "" : typeof v === "string" ? v.trim() : v),
    z.union([z.literal(""), z.string().email()])
  )
  .transform((v) => (v ? String(v).toLowerCase() : ""));

/**
 * Strict identifier shape. Restricted to URL-safe alphanumerics + `_` / `-`.
 *
 * Why so strict: every CRM identifier ultimately flows into a PostgREST
 * `.or(\`col.eq.${id},...\`)` filter or path param. PostgREST treats `,`
 * `(` `)` `:` `.` as syntax. An id allowed to contain those characters
 * could inject extra `or` / `and` predicates and bypass filters at the DB
 * layer (RLS still applies, but row-level filters do not). Every existing
 * id in the live DB (patients, employees, billings, receipts, invoices,
 * duties, payouts, inquiries, doctors, vendors, users — 299 rows audited
 * 28 May 2026) already matches this regex.
 */
export const idSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid id format");

// P1-26: previous isoDate was `refine(Date.parse)` — that accepts almost
// anything: "12 jan", "2026/01/02", trailing junk after a valid prefix.
// Some downstream queries were doing string compares (`<= today_str`) on
// these values and silently returning the wrong window. Lock it down to a
// strict YYYY-MM-DD shape with a sanity-check on the calendar parts, and
// re-verify the trip through Date so leap-day garbage like 2026-02-31
// can't land in the DB.
export const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "isoDate must be YYYY-MM-DD")
  .refine((v) => {
    const [y, m, d] = v.split("-").map((n) => Number.parseInt(n, 10));
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return (
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d
    );
  }, "Invalid calendar date");

/**
 * Map of three-letter English month abbreviations → 1-12. Used by the legacy
 * "D MMM YYYY" date strings that the SPA used to write into Supabase.
 */
const LEGACY_MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};

/**
 * Coerce any reasonable date string into ISO `YYYY-MM-DD`. Recognises:
 *  - already-ISO `YYYY-MM-DD`
 *  - legacy SPA `"D MMM YYYY"` (e.g. `"9 May 2026"`)
 *  - any `Date.parse`-able input as a final fallback
 *
 * Returns the original string unchanged if it can't be parsed (so a clear
 * downstream error surfaces instead of writing a silent placeholder).
 */
export function normaliseDateString(input: unknown): string {
  if (input == null) return "";
  const raw = String(input).trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const legacyMatch = raw.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (legacyMatch) {
    const day = Number(legacyMatch[1]);
    const month = LEGACY_MONTHS[legacyMatch[2].toLowerCase()];
    const year = Number(legacyMatch[3]);
    if (month && day >= 1 && day <= 31) {
      return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
    }
  }
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed);
    const y = d.getUTCFullYear().toString().padStart(4, "0");
    const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
    const dd = d.getUTCDate().toString().padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }
  return raw;
}

/**
 * Optional date column that auto-normalises into ISO `YYYY-MM-DD`. Use this
 * for *all* row-level date fields (`hh_svc_entries.date`,
 * `hh_payout_charges.date`, `hh_receipts.date`, etc.) so writes never drift
 * back to the legacy "D MMM YYYY" SPA format.
 */
export const optionalIsoDate = z
  .string()
  .optional()
  .default("")
  .transform((v) => normaliseDateString(v));

export const moneySchema = z.preprocess(
  (v) => (typeof v === "string" ? Number(v) : v),
  z.number().finite().min(0)
);

export const positiveInt = z.preprocess(
  (v) => (typeof v === "string" ? parseInt(v, 10) : v),
  z.number().int().min(0)
);

export const monthPeriodSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "period must be YYYY-MM");

/**
 * Shift types used by *scheduled duties* — strictly the four full-shift
 * buckets that have well-defined start/end times. Keep narrow so the duty
 * scheduler can do hour math without special-cases.
 */
export const shiftTypeSchema = z.enum(["DAY", "NIGHT", "24H", "FULL"]);

/**
 * Shift types used by *staff & patient profiles* — wider because the legacy
 * CRM offers `1 Hour Service` (one-time visits) and `Custom hours` for
 * staff who aren't on a standard shift.
 */
export const extendedShiftTypeSchema = z.enum([
  "DAY",
  "NIGHT",
  "24H",
  "FULL",
  "ONE_TIME",
  "CUSTOM"
]);

/**
 * Map legacy SPA shift labels (and lowercase / spaced variants) into the
 * canonical enum values. The old desktop CRM stored human strings like
 * `"Day Shift (9:00 AM – 7:00 PM)"` or `"24 Hours Shift"` in the same
 * `shift` column, so any round-trip through the React form would otherwise
 * fail Zod's enum check on every legacy row.
 *
 * Returns `undefined` when the input cannot be mapped, letting the caller
 * fall back to its own default (e.g. `"DAY"`) instead of throwing.
 */
export function normaliseShiftType(input: unknown): string | undefined {
  if (input == null) return undefined;
  const raw = String(input).trim();
  if (!raw) return undefined;
  const upper = raw.toUpperCase();
  if (
    upper === "DAY" ||
    upper === "NIGHT" ||
    upper === "24H" ||
    upper === "FULL" ||
    upper === "ONE_TIME" ||
    upper === "CUSTOM"
  ) {
    return upper;
  }
  const lower = raw.toLowerCase();
  if (lower.includes("24")) return "24H";
  if (lower.startsWith("night")) return "NIGHT";
  if (lower.startsWith("day")) return "DAY";
  if (lower.includes("one") || lower.includes("1 hour") || lower.includes("1hr")) return "ONE_TIME";
  if (lower.includes("custom")) return "CUSTOM";
  if (lower.includes("full")) return "FULL";
  return undefined;
}

/**
 * Optional shift-type field that tolerates the empty / null values the
 * React forms send back when the user hasn't set a shift yet, AND legacy
 * SPA labels like `"Day Shift (9:00 AM – 7:00 PM)"`. Uses the wider enum
 * so it accepts ONE_TIME / CUSTOM employees.
 */
export const optionalShiftType = z.preprocess(
  (v) => normaliseShiftType(v),
  extendedShiftTypeSchema.optional()
);

/**
 * Lenient text field — coerces nulls / undefineds to "" so round-tripping
 * a record from a GET into a PATCH never trips a `string|null` mismatch.
 */
export const optionalText = z.preprocess(
  (v) => (v == null ? "" : v),
  z.string().optional().default("")
);

/** Standard list query params for GET /api/v1/* routes. */
export const listQuerySchema = z.object({
  limit: positiveInt.optional().default(50),
  offset: positiveInt.optional().default(0),
  q: z.string().optional().default("")
});

export type ListQueryInput = z.infer<typeof listQuerySchema>;
