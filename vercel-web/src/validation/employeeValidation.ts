import { z } from "zod";
import {
  idSchema,
  optionalEmail,
  optionalShiftType,
  optionalText
} from "@/validation/commonValidation";

/**
 * Optional 0-10 performance score. Accepts numbers, numeric strings,
 * empty strings (treated as "not set"), null/undefined.
 */
const optionalScore = z.preprocess(
  (v) => {
    if (v == null) return undefined;
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (!trimmed) return undefined;
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : trimmed;
    }
    return v;
  },
  z.number().min(0, "score must be ≥ 0").max(10, "score must be ≤ 10").optional()
);

/** Status values the API will accept. Inactive replaces hard-delete. */
export const EMPLOYEE_STATUSES = ["Active", "Inactive", "OnLeave", "Suspended"] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

/** Shift values aligned with `crm-options.js`. */
export const EMPLOYEE_SHIFT_TYPES = [
  "DAY",
  "NIGHT",
  "24H",
  "FULL",
  "ONE_TIME",
  "CUSTOM"
] as const;

/** Designation / role catalogue. Keep loose: legacy data uses many strings. */
export const EMPLOYEE_ROLES = ["NURSE", "ATTENDANT", "STAFF", "ACCOUNTANT", "OTHER"] as const;

/** Minimum digit count after stripping non-numeric chars. */
const MIN_MOBILE_DIGITS = 10;

const AADHAR_RE = /^\d{12}$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

function normalizeAadharDigits(raw: string | undefined | null): string {
  return String(raw || "").replace(/\D/g, "");
}

function normalizePan(raw: string | undefined | null): string {
  return String(raw || "")
    .trim()
    .toUpperCase();
}

/** Normalised digits-only phone for storage. */
function normalizeMobile(raw: string | undefined | null): string {
  return (raw || "").replace(/[^0-9+]/g, "");
}

/**
 * YYYY-MM-DD form input. Coerces null / undefined / whitespace to "" so the
 * UI's `GET → modify → PATCH` round-trip never trips a `null` rejection on
 * an unset date column.
 */
const dateOnly = z.preprocess(
  (v) => {
    if (v == null) return "";
    if (typeof v === "string") return v.trim();
    return v;
  },
  z
    .string()
    .optional()
    .default("")
    .refine(
      (v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isNaN(Date.parse(v)),
      "Expected ISO date (YYYY-MM-DD)"
    )
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
    email: optionalEmail,
    gender: z.string().optional().default(""),
    dob: dateOnly,
    phone2: z.string().optional().default(""),
    blood: z.string().optional().default(""),
    addr: z.string().optional().default(""),
    address: z.string().optional().default(""),
    area: z.string().optional().default(""),
    city: z.string().optional().default("Ahmedabad"),
    pin: z.string().optional().default(""),
    pincode: z.string().optional(),
    district: z.string().optional().default(""),
    state: z.string().optional().default(""),
    dept: z.string().optional().default(""),
    desig: z.string().optional().default(""),
    role: z.string().optional(),
    emp_type: z.string().optional().default(""),
    etype: z.string().optional(),
    shift: z.string().optional().default(""),
    shift_type: optionalShiftType,
    edu: z.string().optional().default(""),
    education: z.string().optional(),
    exp: z.string().optional().default(""),
    company: z.string().optional().default(""),
    join: dateOnly,
    join_date: dateOnly,
    joining_date: dateOnly,
    leave: dateOnly,
    leave_date: dateOnly,
    salary: z.coerce.number().min(0, "Salary must be ≥ 0").optional().default(0),
    /** Omit on PATCH to keep existing status; create defaults to Active in service. */
    status: z.enum(EMPLOYEE_STATUSES).optional(),
    active: z.boolean().optional(),
    expected_updated_at: z.string().trim().optional(),
    confirm_duplicate_name: z
      .union([z.boolean(), z.string()])
      .optional()
      .transform((v) => v === true || v === "true" || v === "1"),
    aadhar: z.string().optional().default(""),
    pan: z.string().optional().default(""),
    permaddr: z.string().optional().default(""),
    permpin: z.string().optional().default(""),
    permdist: z.string().optional().default(""),
    permstate: z.string().optional().default(""),
    presaddr: z.string().optional().default(""),
    prespin: z.string().optional().default(""),
    presdist: z.string().optional().default(""),
    presstate: z.string().optional().default(""),
    ecname: z.string().optional().default(""),
    ecphone: z.string().optional().default(""),
    ecrel: z.string().optional().default(""),
    relname: z.string().optional().default(""),
    relphone: z.string().optional().default(""),
    refname: z.string().optional().default(""),
    refphone: z.string().optional().default(""),
    skills: z.string().optional().default(""),
    /**
     * Performance score (1-10). Three components mirror the legacy CRM:
     * - score_experience  : skill / years-on-job
     * - score_behaviour   : on-floor behaviour with patient & family
     * - score_testimonial : patient / supervisor feedback
     * `score_total` is the average of the three; we accept it on write so the
     * client can show the value immediately without a round-trip, but the
     * server keeps it consistent with the three components.
     */
    score_experience: optionalScore,
    score_behaviour: optionalScore,
    score_testimonial: optionalScore,
    score_total: optionalScore,
    photo: z.any().optional(),
    docs: z.any().optional(),
    documents: z.any().optional()
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

    const aadharDigits = normalizeAadharDigits(v.aadhar);
    if (aadharDigits && !AADHAR_RE.test(aadharDigits)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Aadhar must be exactly 12 digits",
        path: ["aadhar"]
      });
    }

    const panNorm = normalizePan(v.pan);
    if (panNorm && !PAN_RE.test(panNorm)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "PAN must match format ABCDE1234F",
        path: ["pan"]
      });
    }
  })
  .transform((v) => {
    const full = (v.name || v.full_name || `${v.fn || ""} ${v.ln || ""}`).trim();
    const parts = full.split(/\s+/);
    const shift = v.shift || v.shift_type || "";
    const join = v.join || v.join_date || v.joining_date || "";
    const leave = v.leave || v.leave_date || "";
    const status: EmployeeStatus | undefined =
      v.status ?? (v.active === false ? "Inactive" : v.active === true ? "Active" : undefined);
    const provided = [v.score_experience, v.score_behaviour, v.score_testimonial].filter(
      (n): n is number => typeof n === "number"
    );
    const computedTotal = provided.length
      ? Math.round((provided.reduce((a, b) => a + b, 0) / provided.length) * 100) / 100
      : v.score_total;
    const aadharNorm = normalizeAadharDigits(v.aadhar);
    const panNorm = normalizePan(v.pan);
    return {
      ...v,
      fn: v.fn || parts[0] || "",
      ln: v.ln || (parts.length > 1 ? parts[parts.length - 1] : ""),
      mn: v.mn || (parts.length > 2 ? parts.slice(1, -1).join(" ") : ""),
      phone: normalizeMobile(v.phone || v.mobile),
      aadhar: aadharNorm || v.aadhar || "",
      pan: panNorm || v.pan || "",
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
      status,
      score_experience: v.score_experience,
      score_behaviour: v.score_behaviour,
      score_testimonial: v.score_testimonial,
      score_total: computedTotal
    };
  });

export type EmployeeInput = z.infer<typeof employeeSchema>;

/** PATCH /employees/[id]/status body. */
export const employeeStatusSchema = z.object({
  status: z.enum(EMPLOYEE_STATUSES),
  reason: z.string().optional().default("")
});
export type EmployeeStatusInput = z.infer<typeof employeeStatusSchema>;

/**
 * Legacy SPA upsert — mirrors `toSbEmployee()` so Phase 7e can route
 * `sbUpsert('hh_employees', …)` through the audited service layer.
 */
export const employeeLegacySyncSchema = z
  .object({
    id: idSchema.optional(),
    fn: z.string().trim().min(1, "first name is required"),
    mn: z.string().optional().default(""),
    ln: z.string().optional().default(""),
    email: z.string().optional().default(""),
    phone: z.string().trim().min(1, "phone is required"),
    phone2: z.string().optional().default(""),
    gender: z.string().optional().default(""),
    dob: z.string().optional().default(""),
    blood: z.string().optional().default(""),
    dept: z.string().optional().default(""),
    etype: z.string().optional().default(""),
    desig: z.string().optional().default(""),
    emp_type: z.string().optional().default(""),
    edu: z.string().optional().default(""),
    join_date: z.string().optional().default(""),
    leave_date: z.string().optional().default(""),
    exp: z.string().optional().default(""),
    shift: z.string().optional().default(""),
    salary: z.union([z.string(), z.number()]).optional().default(""),
    aadhar: z.string().optional().default(""),
    pan: z.string().optional().default(""),
    permaddr: z.string().optional().default(""),
    presaddr: z.string().optional().default(""),
    pin: z.string().optional().default(""),
    district: z.string().optional().default(""),
    state: z.string().optional().default(""),
    ecname: z.string().optional().default(""),
    ecphone: z.string().optional().default(""),
    ecrel: z.string().optional().default(""),
    skills: z.string().optional().default(""),
    area: z.string().optional().default(""),
    status: z.enum(EMPLOYEE_STATUSES).optional().default("Active"),
    created: z.string().optional().default(""),
    photo: z.any().optional(),
    docs: z.any().optional()
  })
  .superRefine((v, ctx) => {
    const digits = String(v.phone || "").replace(/[^0-9]/g, "");
    if (digits.length < MIN_MOBILE_DIGITS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `mobile must contain at least ${MIN_MOBILE_DIGITS} digits`,
        path: ["phone"]
      });
    }
  });
export type EmployeeLegacySyncInput = z.infer<typeof employeeLegacySyncSchema>;
