import { z } from "zod";
import { idSchema, isoDate, shiftTypeSchema } from "@/validation/commonValidation";

export const dutySchema = z
  .object({
    id: idSchema.optional(),
    patient_id: idSchema,
    employee_id: idSchema,
    service_type: z.string().optional().default(""),
    shift_type: shiftTypeSchema.default("DAY"),
    start_at: isoDate,
    end_at: isoDate,
    status: z.enum(["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"]).default("SCHEDULED"),
    cancel_reason: z.string().optional().default(""),
    notes: z.string().optional().default(""),
    billing_id: z.string().optional().nullable()
  })
  .refine((v) => new Date(v.end_at).getTime() > new Date(v.start_at).getTime(), {
    message: "end_at must be after start_at",
    path: ["end_at"]
  });

/** Optional timestamp for duty check-in / check-out routes. */
export const dutyCheckAtSchema = z.object({
  at: z.string().optional()
});

export type DutyInput = z.infer<typeof dutySchema>;
export type DutyCheckAtInput = z.infer<typeof dutyCheckAtSchema>;
