import { z } from "zod";
import { idSchema } from "@/validation/commonValidation";

/** Status values the API will accept. Inactive replaces hard-delete. */
export const EMPLOYEE_STATUSES = ["Active", "Inactive", "OnLeave", "Suspended"] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

/** Shift values aligned with `crm-options.js` (DAY/NIGHT/24H/FULL). */
export const EMPLOYEE_SHIFT_TYPES = ["DAY", "NIGHT", "24H", "FULL"] as const;

/** Designation / role catalogue. Keep loose: legacy data uses many strings. */
export const EMPLOYEE_ROLES = ["NURSE", "ATTENDANT", "STAFF", "ACCOUNTANT", "OTHER"] as const;

/** Minimum digit count after stripping non-numeric chars. */
const MIN_MOBILE_DIGITS = 10;

/** Normalised digits-only phone for storage. */
function normalizeMobile(raw: string | undefined | null): string {
  return (raw || "").replace(/[^0-9+]/g, "");
}

/** YYYY-MM-DD form input. */
const dateOnly = z
  .string()
  .trim()
  .optional()
  .default("")
  .refine(
    (v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isNaN(Date.parse(v)),
    "Expected ISO date (YYYY-MM-DD)"
  );

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
    dob: dateOnly,
    addr: z.string().optional().default(""),
    area: z.string().optional().default(""),
    city: z.string().optional().default("Ahmedabad"),
    pin: z.string().optional().default(""),
    dept: z.string().optional().default(""),
    desig: z.string().optional().default(""),
    role: z.string().optional(),
    emp_type: z.string().optional().default(""),
    etype: z.string().optional(),
    shift: z.string().optional().default(""),
    shift_type: z.enum(EMPLOYEE_SHIFT_TYPES).optional(),
    join: dateOnly,
    join_date: dateOnly,
    joining_date: dateOnly,
    leave: dateOnly,
    leave_date: dateOnly,
    salary: z.coerce.number().min(0, "Salary must be ≥ 0").optional().default(0),
    status: z.enum(EMPLOYEE_STATUSES).optional().default("Active"),
    active: z.boolean().optional(),
    relname: z.string().optional().default(""),
    relphone: z.string().optional().default(""),
    docs: z.any().optional()
  })
  .superRefine((v, ctx) => {
    const hasName = v.fn || v.ln || v.name || v.full_name;
    if (!hasName) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "name is required", path: ["fn"] });

    const rawPhone = v.phone || v.mobile || "";
    const digits = rawPhone.replace(/[^0-9]/g, "");
    if (!rawPhone) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "mobile is required", path: ["phone"] });
    } else if (digits.length < MIN_MOBILE_DIGITS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `mobile must contain at least ${MIN_MOBILE_DIGITS} digits`,
        path: ["phone"]
      });
    }

    const rawJoin = v.join || v.join_date || v.joining_date;
    const rawLeave = v.leave || v.leave_date;
    if (rawJoin && rawLeave) {
      const j = Date.parse(rawJoin);
      const l = Date.parse(rawLeave);
      if (!Number.isNaN(j) && !Number.isNaN(l) && l < j) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "leave date cannot be before joining date",
          path: ["leave_date"]
        });
      }
    }
  })
  .transform((v) => {
    const full = (v.name || v.full_name || `${v.fn || ""} ${v.ln || ""}`).trim();
    const parts = full.split(/\s+/);
    const shift = v.shift || v.shift_type || "";
    const join = v.join || v.join_date || v.joining_date || "";
    const leave = v.leave || v.leave_date || "";
    const status: EmployeeStatus = v.status ?? (v.active === false ? "Inactive" : "Active");
    return {
      ...v,
      fn: v.fn || parts[0] || "",
      ln: v.ln || (parts.length > 1 ? parts[parts.length - 1] : ""),
      mn: v.mn || (parts.length > 2 ? parts.slice(1, -1).join(" ") : ""),
      phone: normalizeMobile(v.phone || v.mobile),
      emp_type: v.emp_type || v.etype || "",
      etype: v.etype || v.emp_type || "",
      desig: v.desig || v.role || "",
      role: v.role || v.desig || "",
      shift,
      shift_type: (shift || "DAY") as (typeof EMPLOYEE_SHIFT_TYPES)[number],
      join,
      join_date: join,
      joining_date: join,
      leave,
      leave_date: leave,
      status
    };
  });

export type EmployeeInput = z.infer<typeof employeeSchema>;

/** PATCH /employees/[id]/status body. */
export const employeeStatusSchema = z.object({
  status: z.enum(EMPLOYEE_STATUSES),
  reason: z.string().optional().default("")
});
export type EmployeeStatusInput = z.infer<typeof employeeStatusSchema>;
