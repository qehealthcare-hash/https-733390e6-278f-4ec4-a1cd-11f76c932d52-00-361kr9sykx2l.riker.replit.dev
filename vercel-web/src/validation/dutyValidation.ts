import { z } from "zod";
import { idSchema, isoDateTime, positiveInt, shiftTypeSchema } from "@/validation/commonValidation";

/** Lifecycle states a duty can hold. */
export const DUTY_STATUSES = [
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW"
] as const;
export type DutyStatus = (typeof DUTY_STATUSES)[number];

/** Shifts the CRM understands today (synced with `crm-options.shiftOptions`). */
export const DUTY_SHIFT_TYPES = ["DAY", "NIGHT", "24H", "FULL"] as const;
export type DutyShiftType = (typeof DUTY_SHIFT_TYPES)[number];

/**
 * Canonical Duty payload accepted by /api/v1/duties.
 * Includes inline cross-field guards: end_at > start_at, COMPLETED needs no
 * cancel_reason, CANCELLED requires a reason for audit hygiene.
 */
const dutyPartnerSchema = z.object({
  employee_id: idSchema,
  charge_per_day: z.coerce.number().min(0).optional(),
  payout_per_day: z.coerce.number().min(0).optional(),
  payout_term: z.string().trim().max(40).optional()
});

export const dutySchema = z
  .object({
    id: idSchema.optional(),
    patient_id: idSchema,
    employee_id: idSchema,
    service_type: z.string().optional().default(""),
    service_name: z.string().trim().max(120).optional().default(""),
    shift_type: shiftTypeSchema.default("DAY"),
    start_at: isoDateTime,
    /**
     * Optional. Omit (or pass blank/null) to mark the duty as open-ended —
     * the diary materializer will keep adding per-day charges and payouts
     * to the patient's Active bill until the bill is closed. When given,
     * the duty stops on this date even if the bill remains open.
     */
    end_at: isoDateTime.optional(),
    status: z.enum(DUTY_STATUSES).default("SCHEDULED"),
    cancel_reason: z.string().optional().default(""),
    notes: z.string().optional().default(""),
    billing_id: z.string().optional().nullable(),
    charge_per_day: z.coerce.number().min(0).optional().default(0),
    payout_per_day: z.coerce.number().min(0).optional().default(0),
    payout_term: z.string().trim().max(40).optional().default("Daily"),
    extra_partners: z.array(dutyPartnerSchema).optional().default([]),
    expected_updated_at: z.string().optional(),
    /** When true, expands date range into hh_svc_entries + hh_payout_charges after save. */
    materialize: z.boolean().optional().default(false),
    /** Allow saving even if the staff has another overlapping duty (relief / partner share). */
    confirm_staff_overlap: z.boolean().optional().default(false),
    confirm_patient_overlap: z.boolean().optional().default(false)
  })
  .superRefine((v, ctx) => {
    if (v.patient_id && v.employee_id && v.patient_id === v.employee_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "patient_id and employee_id must be different",
        path: ["employee_id"]
      });
    }
    if (v.end_at) {
      if (new Date(v.end_at).getTime() <= new Date(v.start_at).getTime()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "end_at must be after start_at",
          path: ["end_at"]
        });
      }
    }
    if (v.status === "CANCELLED" && !v.cancel_reason.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "cancel_reason is required when status is CANCELLED",
        path: ["cancel_reason"]
      });
    }
  });

/** PATCH /duties/[id]/check-in or /check-out body. */
export const dutyCheckAtSchema = z.object({
  at: isoDateTime.optional()
});

/** DELETE /duties/[id] body (or query) — explicit reason. */
export const dutyCancelSchema = z.object({
  reason: z.string().trim().min(1, "Cancellation reason is required").max(500)
});

export const dutyDiaryBatchSchema = z.object({
  duty_ids: z
    .array(z.string().trim().min(1))
    .max(500, "At most 500 duty ids per batch request")
    .default([])
});

/** GET /duties query string. */
export const dutyListQuerySchema = z.object({
  limit: positiveInt.optional().default(50),
  offset: positiveInt.optional().default(0),
  q: z.string().optional().default(""),
  employee_id: z.string().optional(),
  patient_id: z.string().optional(),
  status: z.enum(DUTY_STATUSES).optional(),
  from: z.string().optional(),
  to: z.string().optional()
});

export type DutyInput = z.infer<typeof dutySchema>;
export type DutyCheckAtInput = z.infer<typeof dutyCheckAtSchema>;
export type DutyCancelInput = z.infer<typeof dutyCancelSchema>;
export type DutyListQuery = z.infer<typeof dutyListQuerySchema>;

/** POST /duties/[id]/materialize — expand duty window to per-day diary rows. */
export const dutyMaterializeSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  dry_run: z.boolean().optional().default(false)
});

/** POST /duties/[id]/partners — replace extra partner assignments. */
export const dutyPartnersSchema = z.object({
  extra_partners: z.array(dutyPartnerSchema).default([]),
  materialize: z.boolean().optional().default(true)
});

export type DutyMaterializeInput = z.infer<typeof dutyMaterializeSchema>;
export type DutyPartnersInput = z.infer<typeof dutyPartnersSchema>;
