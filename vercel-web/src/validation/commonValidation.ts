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

export const idSchema = z.string().trim().min(1).max(64);

export const isoDate = z.string().trim().min(1).refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date");

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

export const shiftTypeSchema = z.enum(["DAY", "NIGHT", "24H", "FULL"]);

/**
 * Optional shift-type field that tolerates the empty / null values the
 * React forms send back when the user hasn't set a shift yet.
 */
export const optionalShiftType = z.preprocess(
  (v) => (v == null || v === "" ? undefined : v),
  shiftTypeSchema.optional()
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
