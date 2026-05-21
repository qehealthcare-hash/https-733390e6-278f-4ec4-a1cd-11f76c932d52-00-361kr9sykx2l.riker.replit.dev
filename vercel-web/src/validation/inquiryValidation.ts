import { z } from "zod";
import { emailSchema, idSchema } from "@/validation/commonValidation";

/**
 * Accepts legacy `hh_*` field names and React UI aliases (patient_name, mobile, …).
 */
export const inquirySchema = z
  .object({
    id: idSchema.optional(),
    name: z.string().trim().min(1).max(120).optional(),
    patient_name: z.string().trim().min(1).max(120).optional(),
    phone: z.string().trim().optional(),
    mobile: z.string().trim().optional(),
    wa: z.string().trim().optional(),
    age: z.string().optional().default(""),
    gender: z.string().optional().default(""),
    city: z.string().optional().default("Ahmedabad"),
    area: z.string().optional().default(""),
    address: z.string().optional().default(""),
    service: z.string().optional().default(""),
    service_required: z.string().optional(),
    source: z.string().optional().default("WHATSAPP"),
    potential: z.string().optional().default("WARM"),
    rating_emergency: z.coerce.number().min(0).max(10).optional(),
    rating_flexibility: z.coerce.number().min(0).max(10).optional(),
    rating_overall: z.coerce.number().min(0).max(10).optional(),
    emergency_level: z.coerce.number().min(0).max(10).optional(),
    flexibility_score: z.coerce.number().min(0).max(10).optional(),
    priority_score: z.coerce.number().min(0).max(10).optional(),
    status: z.string().optional().default("New"),
    assigned_to: z.string().optional().default(""),
    followup_date: z.string().optional().default(""),
    remarks: z.string().optional().default(""),
    notes: z.string().optional().default(""),
    email: emailSchema.optional()
  })
  .superRefine((v, ctx) => {
    if (!v.name && !v.patient_name) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "name is required", path: ["name"] });
    }
    if (!v.phone && !v.mobile) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "phone is required", path: ["phone"] });
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
