import { z } from "zod";
import {
  idSchema,
  isoDate,
  optionalEmail,
  optionalShiftType,
  shiftTypeSchema
} from "@/validation/commonValidation";

export const PATIENT_STATUSES = ["Active", "Closed", "On Hold"] as const;
export type PatientStatus = (typeof PATIENT_STATUSES)[number];

/**
 * Statuses the legacy SPA may persist. The DB column is plain text so we
 * accept any of these on the `/patients/sync` upsert path without coercing
 * to the trimmed enum above.
 */
export const PATIENT_LEGACY_STATUSES = [
  "Active",
  "Paused",
  "Duty Closed",
  "Expired",
  "Deceased",
  "Discharged",
  "On Hold",
  "Closed"
] as const;

const patientPhoneSchema = z
  .string()
  .trim()
  .min(7, "phone too short")
  .max(20, "phone too long")
  .regex(/^[0-9+\-\s()]+$/, "invalid phone characters")
  .transform((p) => p.replace(/[^0-9+]/g, ""));

export const patientSchema = z
  .object({
    id: idSchema.optional(),
    name: z.string().trim().min(1).max(160).optional(),
    full_name: z.string().trim().min(1).max(160).optional(),
    phone: patientPhoneSchema.optional(),
    mobile: patientPhoneSchema.optional(),
    dob: z.string().max(20).optional().default(""),
    age: z.string().max(10).optional().default(""),
    gender: z.string().max(20).optional().default(""),
    blood: z.string().max(10).optional().default(""),
    addr: z.string().max(500).optional().default(""),
    address: z.string().max(500).optional().default(""),
    area: z.string().max(120).optional().default(""),
    city: z.string().max(80).optional().default("Ahmedabad"),
    pin: z.string().max(12).optional().default(""),
    pincode: z.string().max(12).optional(),
    relname: z.string().max(120).optional().default(""),
    relphone: z.string().max(20).optional().default(""),
    relname2: z.string().max(120).optional().default(""),
    relphone2: z.string().max(20).optional().default(""),
    relname3: z.string().max(120).optional().default(""),
    relphone3: z.string().max(20).optional().default(""),
    email: optionalEmail,
    status: z.enum(PATIENT_STATUSES).optional().default("Active"),
    // Reason text is accepted by the API (for audit) but NOT a column on
    // hh_patients; the service layer omits it from the row write.
    status_reason: z.string().max(120).optional().default(""),
    status_reason_other: z.string().max(500).optional().default(""),
    shift: z.string().max(20).optional().default(""),
    shift_type: optionalShiftType,
    caretaker_id: z.string().max(64).optional().default(""),
    assigned_staff_id: z.string().max(64).optional(),
    /**
     * Free-text patient diagnosis / condition. The new React form exposes
     * this as a textarea; the legacy SPA did not have a backing column so
     * it was silently dropped on every save until column 017.
     */
    disease_condition: z.string().max(2000).optional().default(""),
    /**
     * Care start date (YYYY-MM-DD). Stored as text to match the legacy
     * date encoding everywhere else in the schema. Empty string means
     * "use registration date".
     */
    start_date: z.string().max(20).optional().default(""),
    photo: z.any().optional(),
    docs: z.any().optional()
  })
  .superRefine((v, ctx) => {
    if (!v.name && !v.full_name) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "name is required", path: ["name"] });
    }
    if (!v.phone && !v.mobile) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "phone is required", path: ["phone"] });
    }
  })
  .transform((v) => ({
    ...v,
    name: v.name || v.full_name || "",
    phone: (v.phone || v.mobile || "").replace(/[^0-9+]/g, ""),
    addr: v.addr || v.address || "",
    pin: v.pin || v.pincode || "",
    shift: v.shift || v.shift_type || "",
    caretaker_id: v.caretaker_id || v.assigned_staff_id || ""
  }));

export const patientAssignSchema = z.object({
  caretaker_id: idSchema,
  shift: shiftTypeSchema.default("DAY")
});

export const patientListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  q: z.string().optional().default(""),
  status: z.enum(PATIENT_STATUSES).optional(),
  caretaker_id: z.string().optional(),
  /**
   * Inclusive YYYY-MM-DD bounds against `created_at` so Reports can ask the
   * server for "patients registered in this period" instead of filtering on
   * the client.
   */
  from: isoDate.optional(),
  to: isoDate.optional()
});

export type PatientInput = z.infer<typeof patientSchema>;
export type PatientAssignInput = z.infer<typeof patientAssignSchema>;
export type PatientListQuery = z.infer<typeof patientListQuerySchema>;

/**
 * Legacy SPA upsert payload — mirrors `toSbPatient()`. Status is the legacy
 * enum (`Active|Paused|Duty Closed|...`). Photos / docs are passed through
 * unless missing (light refresh path).
 */
export const patientLegacySyncSchema = z.object({
  id: idSchema.optional(),
  name: z.string().trim().min(1).max(160),
  email: z.string().max(200).optional().default(""),
  phone: z.string().max(40).optional().default(""),
  dob: z.string().max(20).optional().default(""),
  gender: z.string().max(20).optional().default(""),
  blood: z.string().max(10).optional().default(""),
  addr: z.string().max(500).optional().default(""),
  address: z.string().max(500).optional().default(""),
  area: z.string().max(120).optional().default(""),
  city: z.string().max(80).optional().default(""),
  pin: z.string().max(12).optional().default(""),
  relname: z.string().max(120).optional().default(""),
  relphone: z.string().max(40).optional().default(""),
  relname2: z.string().max(120).optional().default(""),
  relphone2: z.string().max(40).optional().default(""),
  relname3: z.string().max(120).optional().default(""),
  relphone3: z.string().max(40).optional().default(""),
  status: z.enum(PATIENT_LEGACY_STATUSES).optional().default("Active"),
  status_reason: z.string().max(120).optional().default(""),
  status_reason_other: z.string().max(500).optional().default(""),
  created: z.string().max(40).optional().default(""),
  /** Optional JSON blob — present on the "full" save, absent on `__light` refreshes. */
  photo: z.any().optional(),
  docs: z.any().optional()
});
export type PatientLegacySyncInput = z.infer<typeof patientLegacySyncSchema>;
