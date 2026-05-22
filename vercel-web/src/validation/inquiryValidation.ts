import { z } from "zod";
import { idSchema, isoDate, optionalEmail } from "@/validation/commonValidation";

/**
 * Inquiry lifecycle.
 *
 * Open: `New`, `Contacted`, `FollowUp`, `Negotiating`.
 * Closed: `Converted`, `Closed`, `Lost`. (Matches the DB partial unique index
 * `uq_hh_inquiries_active_phone` which only enforces dup-prevention while the
 * inquiry is in an Open status.)
 */
export const INQUIRY_OPEN_STATUSES = ["New", "Contacted", "FollowUp", "Negotiating"] as const;
export const INQUIRY_CLOSED_STATUSES = ["Converted", "Closed", "Lost"] as const;
export const INQUIRY_STATUSES = [
  ...INQUIRY_OPEN_STATUSES,
  ...INQUIRY_CLOSED_STATUSES
] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export const INQUIRY_CLOSED_SET = new Set<InquiryStatus>(INQUIRY_CLOSED_STATUSES);

/** Lead source — also accepted lowercase since the legacy UI sends mixed case. */
export const INQUIRY_SOURCES = [
  "WHATSAPP",
  "CALL",
  "REFERRAL",
  "WEBSITE",
  "WALK_IN",
  "FACEBOOK",
  "INSTAGRAM",
  "GOOGLE",
  "OTHER"
] as const;

export const INQUIRY_POTENTIAL = ["HOT", "WARM", "COLD"] as const;

/**
 * Phone schema for inquiries.
 *
 * Loose by design — the legacy CRM accepts partials before the lead is
 * qualified. We just normalise to digits-only so duplicate detection works.
 */
const inquiryPhoneSchema = z
  .string()
  .trim()
  .min(7, "phone too short")
  .max(20, "phone too long")
  .regex(/^[0-9+\-\s()]+$/, "invalid phone characters")
  .transform((p) => p.replace(/[^0-9+]/g, ""));

/** Follow-up date may be empty, ISO-date, or YYYY-MM-DD. */
const followupDateSchema = z
  .string()
  .trim()
  .max(40)
  .refine((v) => v === "" || !Number.isNaN(Date.parse(v)), "invalid follow-up date")
  .optional()
  .default("");

const ratingSchema = z.coerce.number().int().min(0).max(10);

/**
 * Canonical inquiry payload.
 *
 * Accepts both legacy `hh_*` field names and React UI aliases
 * (patient_name, mobile, service_required, …). After parsing,
 * normalises to a single shape that matches `inquiryToRow`.
 */
export const inquirySchema = z
  .object({
    id: idSchema.optional(),
    name: z.string().trim().min(1).max(120).optional(),
    patient_name: z.string().trim().min(1).max(120).optional(),
    phone: inquiryPhoneSchema.optional(),
    mobile: inquiryPhoneSchema.optional(),
    wa: z.string().trim().max(20).optional().default(""),
    age: z.string().max(10).optional().default(""),
    gender: z.string().max(20).optional().default(""),
    city: z.string().max(80).optional().default("Ahmedabad"),
    area: z.string().max(120).optional().default(""),
    address: z.string().max(500).optional().default(""),
    service: z.string().max(120).optional().default(""),
    service_required: z.string().max(120).optional(),
    source: z
      .string()
      .trim()
      .max(40)
      .transform((s) => s.toUpperCase())
      .pipe(z.enum(INQUIRY_SOURCES))
      .optional()
      .default("WHATSAPP"),
    potential: z
      .string()
      .trim()
      .max(20)
      .transform((s) => s.toUpperCase())
      .pipe(z.enum(INQUIRY_POTENTIAL))
      .optional()
      .default("WARM"),
    rating_emergency: ratingSchema.optional(),
    rating_flexibility: ratingSchema.optional(),
    rating_overall: ratingSchema.optional(),
    emergency_level: ratingSchema.optional(),
    flexibility_score: ratingSchema.optional(),
    priority_score: ratingSchema.optional(),
    status: z.enum(INQUIRY_STATUSES).optional().default("New"),
    assigned_to: z.string().max(80).optional().default(""),
    followup_date: followupDateSchema,
    remarks: z.string().max(2000).optional().default(""),
    notes: z.string().max(2000).optional().default(""),
    email: optionalEmail
  })
  .superRefine((v, ctx) => {
    if (!v.name && !v.patient_name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "name is required",
        path: ["name"]
      });
    }
    if (!v.phone && !v.mobile) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "phone is required",
        path: ["phone"]
      });
    }
    if (
      (v.status === "FollowUp" || v.status === "Negotiating") &&
      !v.followup_date
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `followup_date is required when status is ${v.status}`,
        path: ["followup_date"]
      });
    }
  })
  .transform((v) => {
    const phone = (v.phone || v.mobile || "").replace(/[^0-9+]/g, "");
    return {
      ...v,
      name: v.name || v.patient_name || "",
      phone,
      wa: (v.wa || phone || "").replace(/[^0-9+]/g, ""),
      service: v.service || v.service_required || "",
      rating_emergency: v.rating_emergency ?? v.emergency_level ?? 5,
      rating_flexibility: v.rating_flexibility ?? v.flexibility_score ?? 5,
      rating_overall: v.rating_overall ?? v.priority_score ?? 5
    };
  });

export type InquiryInput = z.infer<typeof inquirySchema>;

/** Stand-alone status change endpoint. */
export const inquiryStatusSchema = z.object({
  status: z.enum(INQUIRY_STATUSES),
  reason: z.string().trim().max(500).optional().default(""),
  followup_date: followupDateSchema
});
export type InquiryStatusInput = z.infer<typeof inquiryStatusSchema>;

/** Convert payload. Lets the actor force-link to an explicit existing patient. */
export const inquiryConvertSchema = z
  .object({
    patient_id: idSchema.optional(),
    notes: z.string().trim().max(2000).optional().default("")
  })
  .default({ notes: "" });
export type InquiryConvertInput = z.infer<typeof inquiryConvertSchema>;

/** Query params for the listing route. */
export const inquiryListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  q: z.string().optional().default(""),
  status: z.enum(INQUIRY_STATUSES).optional(),
  open_only: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => (v === true || v === "true" || v === "1")),
  source: z.enum(INQUIRY_SOURCES).optional(),
  assigned_to: z.string().optional(),
  followup_from: isoDate.optional(),
  followup_to: isoDate.optional()
});
export type InquiryListQuery = z.infer<typeof inquiryListQuerySchema>;

/**
 * Legacy SPA upsert — mirrors `toSbInquiry()` output.
 */
export const inquiryLegacySyncSchema = z
  .object({
    id: idSchema.optional(),
    name: z.string().trim().min(1, "name is required"),
    phone: inquiryPhoneSchema,
    wa: z.string().trim().max(20).optional().default(""),
    age: z.string().max(10).optional().default(""),
    gender: z.string().max(20).optional().default(""),
    city: z.string().max(80).optional().default(""),
    area: z.string().max(120).optional().default(""),
    service: z.string().max(120).optional().default(""),
    /** Legacy dropdown uses mixed labels (Facebook, Just Dial, …) — store as-is. */
    source: z.string().trim().max(40).optional().default(""),
    potential: z
      .string()
      .trim()
      .max(20)
      .transform((s) => s.toUpperCase())
      .pipe(z.enum(INQUIRY_POTENTIAL))
      .optional()
      .default("WARM"),
    rating_emergency: ratingSchema.optional().default(5),
    rating_flexibility: ratingSchema.optional().default(5),
    rating_overall: ratingSchema.optional().default(5),
    status: z.enum(INQUIRY_STATUSES).optional().default("New"),
    assigned_to: z.string().max(80).optional().default(""),
    followup_date: followupDateSchema,
    notes: z.string().max(2000).optional().default(""),
    created: z.string().max(40).optional().default("")
  })
  .superRefine((v, ctx) => {
    if (
      (v.status === "FollowUp" || v.status === "Negotiating") &&
      !v.followup_date
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `followup_date is required when status is ${v.status}`,
        path: ["followup_date"]
      });
    }
  });
export type InquiryLegacySyncInput = z.infer<typeof inquiryLegacySyncSchema>;
