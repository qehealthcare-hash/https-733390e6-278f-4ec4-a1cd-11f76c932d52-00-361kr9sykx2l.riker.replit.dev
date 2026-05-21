import { z } from "zod";

export const phoneSchema = z
  .string()
  .trim()
  .min(7, "Phone too short")
  .max(20, "Phone too long")
  .regex(/^[0-9+\-\s()]+$/i, "Invalid phone characters")
  .transform((p) => p.replace(/[^0-9+]/g, ""));

export const emailSchema = z.string().trim().email().transform((e) => e.toLowerCase());

export const idSchema = z.string().trim().min(1).max(64);

export const isoDate = z.string().trim().min(1).refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date");

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

/** Standard list query params for GET /api/v1/* routes. */
export const listQuerySchema = z.object({
  limit: positiveInt.optional().default(50),
  offset: positiveInt.optional().default(0),
  q: z.string().optional().default("")
});

export type ListQueryInput = z.infer<typeof listQuerySchema>;
