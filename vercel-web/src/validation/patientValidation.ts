import { z } from "zod";
import { emailSchema, idSchema, shiftTypeSchema } from "@/validation/commonValidation";

export const PATIENT_STATUSES = ["Active", "Closed", "On Hold"] as const;
export type PatientStatus = (typeof PATIENT_STATUSES)[number];

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
    email: emailSchema.optional(),
    status: z.enum(PATIENT_STATUSES).optional().default("Active"),
    shift: z.string().max(20).optional().default(""),
    shift_type: shiftTypeSchema.optional(),
    caretaker_id: z.string().max(64).optional().default(""),
    assigned_staff_id: z.string().max(64).optional(),
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
  caretaker_id: z.string().optional()
});

export type PatientInput = z.infer<typeof patientSchema>;
export type PatientAssignInput = z.infer<typeof patientAssignSchema>;
export type PatientListQuery = z.infer<typeof patientListQuerySchema>;
