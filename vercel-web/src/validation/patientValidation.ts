import { z } from "zod";
import { idSchema, shiftTypeSchema } from "@/validation/commonValidation";

export const patientSchema = z
  .object({
    id: idSchema.optional(),
    name: z.string().trim().min(1).max(160).optional(),
    full_name: z.string().trim().min(1).max(160).optional(),
    phone: z.string().trim().optional(),
    mobile: z.string().trim().optional(),
    dob: z.string().optional().default(""),
    age: z.string().optional().default(""),
    gender: z.string().optional().default(""),
    addr: z.string().optional().default(""),
    address: z.string().optional().default(""),
    area: z.string().optional().default(""),
    city: z.string().optional().default("Ahmedabad"),
    pin: z.string().optional().default(""),
    pincode: z.string().optional(),
    relname: z.string().optional().default(""),
    relphone: z.string().optional().default(""),
    relname2: z.string().optional().default(""),
    relphone2: z.string().optional().default(""),
    relname3: z.string().optional().default(""),
    relphone3: z.string().optional().default(""),
    email: z.string().email().optional(),
    status: z.enum(["Active", "Closed", "On Hold"]).optional().default("Active"),
    shift: z.string().optional().default(""),
    shift_type: shiftTypeSchema.optional(),
    caretaker_id: z.string().optional().default(""),
    assigned_staff_id: z.string().optional(),
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

export type PatientInput = z.infer<typeof patientSchema>;
export type PatientAssignInput = z.infer<typeof patientAssignSchema>;
