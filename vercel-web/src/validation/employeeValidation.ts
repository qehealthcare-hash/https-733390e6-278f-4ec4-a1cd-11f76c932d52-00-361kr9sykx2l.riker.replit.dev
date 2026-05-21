import { z } from "zod";
import { idSchema } from "@/validation/commonValidation";

export const employeeSchema = z
  .object({
    id: idSchema.optional(),
    fn: z.string().trim().optional(),
    ln: z.string().trim().optional(),
    mn: z.string().trim().optional().default(""),
    name: z.string().trim().optional(),
    full_name: z.string().trim().optional(),
    phone: z.string().trim().optional(),
    mobile: z.string().trim().optional(),
    email: z.string().email().optional().or(z.literal("")),
    gender: z.string().optional().default(""),
    dob: z.string().optional().default(""),
    addr: z.string().optional().default(""),
    area: z.string().optional().default(""),
    city: z.string().optional().default("Ahmedabad"),
    pin: z.string().optional().default(""),
    dept: z.string().optional().default(""),
    desig: z.string().optional().default(""),
    emp_type: z.string().optional().default(""),
    etype: z.string().optional(),
    shift: z.string().optional().default(""),
    salary: z.coerce.number().optional().default(0),
    status: z.string().optional().default("Active"),
    relname: z.string().optional().default(""),
    relphone: z.string().optional().default(""),
    docs: z.any().optional()
  })
  .superRefine((v, ctx) => {
    const hasName = v.fn || v.ln || v.name || v.full_name;
    if (!hasName) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "name is required", path: ["fn"] });
    const hasPhone = v.phone || v.mobile;
    if (!hasPhone) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "phone is required", path: ["phone"] });
  })
  .transform((v) => {
    const full = (v.name || v.full_name || `${v.fn || ""} ${v.ln || ""}`).trim();
    const parts = full.split(/\s+/);
    return {
      ...v,
      fn: v.fn || parts[0] || "",
      ln: v.ln || (parts.length > 1 ? parts[parts.length - 1] : ""),
      mn: v.mn || (parts.length > 2 ? parts.slice(1, -1).join(" ") : ""),
      phone: (v.phone || v.mobile || "").replace(/[^0-9+]/g, ""),
      emp_type: v.emp_type || v.etype || "",
      etype: v.etype || v.emp_type || ""
    };
  });

export type EmployeeInput = z.infer<typeof employeeSchema>;
