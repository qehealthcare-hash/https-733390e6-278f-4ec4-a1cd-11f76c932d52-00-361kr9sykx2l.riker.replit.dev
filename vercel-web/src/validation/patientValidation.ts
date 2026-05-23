import { z } from "zod";
import {
  idSchema,
  isoDate,
  optionalEmail,
  optionalShiftType,
  shiftTypeSchema
} from "@/validation/commonValidation";

/**
 * Canonical patient statuses stored in `hh_patients.status`. Matches live
 * data + legacy SPA values so PATCH never silently coerces to "Active".
 */
export const PATIENT_STATUSES = [
  "Active",
  "On Hold",
  "Paused",
  "Duty Closed",
  "Closed",
  "Discharged",
  "Deceased",
  "Expired",
  "Inactive"
] as const;
export type PatientStatus = (typeof PATIENT_STATUSES)[number];

/** Alias kept for `/patients/sync` — same set as PATIENT_STATUSES. */
export const PATIENT_LEGACY_STATUSES = PATIENT_STATUSES;

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
    /** Omit on PATCH to keep existing status; create path defaults to Active in service. */
    status: z.enum(PATIENT_STATUSES).optional(),
    expected_updated_at: z.string().trim().optional(),
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
    docs: z.any().optional(),
    /**
     * Set to true to acknowledge a "patient with the same name already exists"
     * warning and force the create through. Used to bypass the soft duplicate
     * guard when an admin has confirmed it really is a different person.
     */
    confirm_duplicate_name: z
      .union([z.boolean(), z.string()])
      .optional()
      .transform((v) => v === true || v === "true" || v === "1")
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

/**
 * Payload for `DELETE /api/v1/patients/:id` (soft-close). `reason` is the
 * dropdown selection (matches `patientCloseReasonOptions`); `reason_other`
 * is required by the UI when the operator picks "Other". Both default to ""
 * so old clients that DELETE without a body still work.
 */
export const patientCloseSchema = z.object({
  reason: z.string().trim().max(120).optional().default(""),
  reason_other: z.string().trim().max(500).optional().default("")
});

export type PatientCloseInput = z.infer<typeof patientCloseSchema>;

/** Optional note on POST /patients/:id/reopen (audit stamp only). */
export const patientReopenSchema = z.object({
  reason: z.string().trim().max(500).optional().default("")
});

export type PatientReopenInput = z.infer<typeof patientReopenSchema>;

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
