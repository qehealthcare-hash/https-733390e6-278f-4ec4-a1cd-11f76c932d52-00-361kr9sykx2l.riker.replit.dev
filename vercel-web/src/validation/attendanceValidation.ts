import { z } from "zod";
import { idSchema, isoDateTime, shiftTypeSchema } from "@/validation/commonValidation";

/** Lifecycle status of an attendance record. */
export const ATTENDANCE_STATUSES = [
  "PRESENT",
  "ABSENT",
  "LATE",
  "HALF_DAY",
  "LEAVE",
  "HOLIDAY"
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** Subset of statuses that must not carry check-in/out timestamps. */
export const ATTENDANCE_NO_TIME_STATUSES = new Set<AttendanceStatus>([
  "ABSENT",
  "LEAVE",
  "HOLIDAY"
]);

const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
  .optional();

/**
 * Canonical Attendance payload.
 *
 * Cross-field guards:
 *   - PRESENT / LATE / HALF_DAY require `check_in_at` (you can't be "present"
 *     without a clock-in).
 *   - When both timestamps are present, `check_out_at` must be after
 *     `check_in_at`.
 *   - ABSENT / LEAVE / HOLIDAY may not carry a check-out (defensive — frontend
 *     sometimes leaks timestamps from earlier state).
 */
export const attendanceSchema = z
  .object({
    id: idSchema.optional(),
    duty_id: z.string().trim().optional(),
    employee_id: idSchema,
    patient_id: z.string().trim().optional(),
    shift_type: shiftTypeSchema.optional(),
    work_date: dateKeySchema,
    check_in_at: isoDateTime.optional(),
    check_out_at: isoDateTime.optional(),
    status: z.enum(ATTENDANCE_STATUSES).default("PRESENT"),
    notes: z.string().optional().default("")
  })
  .superRefine((v, ctx) => {
    const needsCheckIn = v.status === "PRESENT" || v.status === "LATE" || v.status === "HALF_DAY";
    if (needsCheckIn && !v.check_in_at) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `check_in_at is required when status is ${v.status}`,
        path: ["check_in_at"]
      });
    }
    if (v.check_in_at && v.check_out_at) {
      if (new Date(v.check_out_at).getTime() <= new Date(v.check_in_at).getTime()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "check_out_at must be after check_in_at",
          path: ["check_out_at"]
        });
      }
    }
    if (ATTENDANCE_NO_TIME_STATUSES.has(v.status) && v.check_out_at) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `check_out_at must be empty when status is ${v.status}`,
        path: ["check_out_at"]
      });
    }
  });

/** Mark-attendance payload — same body, but `status` is mandatory (no default fallback for UI safety). */
export const attendanceMarkSchema = attendanceSchema;

/** GET /attendance query. */
export const attendanceListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  q: z.string().optional().default(""),
  employee_id: z.string().optional(),
  duty_id: z.string().optional(),
  patient_id: z.string().optional(),
  status: z.enum(ATTENDANCE_STATUSES).optional(),
  from: dateKeySchema,
  to: dateKeySchema
});

/** POST /attendance/day/mark — quick mark from the day board. */
export const attendanceDayMarkSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  employee_id: idSchema,
  duty_id: z.string().trim().optional(),
  patient_id: z.string().trim().optional(),
  shift_type: shiftTypeSchema.optional(),
  status: z.enum(ATTENDANCE_STATUSES),
  check_in_at: isoDateTime.optional(),
  check_out_at: isoDateTime.optional(),
  notes: z.string().optional().default(""),
  sync_duty: z.boolean().optional().default(true)
});

export type AttendanceInput = z.infer<typeof attendanceSchema>;
export type AttendanceListQuery = z.infer<typeof attendanceListQuerySchema>;
export type AttendanceDayMarkInput = z.infer<typeof attendanceDayMarkSchema>;
