/**
 * Doctor / vendor / settings / user / role validation schemas.
 *
 * Lenient on legacy data (most fields optional) but enforces the small
 * set of required identifiers the corporate audit flagged.
 */

import { z } from "zod";
import { optionalEmail, phoneSchema } from "@/validation/commonValidation";

const trimmed = z.preprocess(
  (v) => (v == null ? "" : String(v).trim()),
  z.string()
);

export const doctorCreateSchema = z
  .object({
    fn: trimmed.refine((v) => v.length > 0, "First name (fn) is required"),
    ln: trimmed.optional(),
    gender: trimmed.optional(),
    phone: phoneSchema,
    email: optionalEmail.optional(),
    city: trimmed.optional(),
    aadhar: trimmed.optional(),
    pan: trimmed.optional(),
    spec: trimmed.optional(),
    qual: trimmed.optional(),
    regno: trimmed.optional(),
    regcouncil: trimmed.optional(),
    regyear: trimmed.optional(),
    clinic: trimmed.optional(),
    clinicaddr: trimmed.optional()
  })
  .passthrough();

export const doctorPatchSchema = doctorCreateSchema.partial().extend({
  expected_updated_at: z.string().trim().optional()
});

export type DoctorCreateInput = z.infer<typeof doctorCreateSchema>;
export type DoctorPatchInput = z.infer<typeof doctorPatchSchema>;
