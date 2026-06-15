import { z } from "zod";
import { idSchema } from "@/validation/commonValidation";
import { ATTENDANCE_STATUSES } from "@/validation/attendanceValidation";

/** Board / range derived status — superset of attendance + duty lifecycle. */
export const ATTENDANCE_DERIVED_STATUSES = [
  "PRESENT",
  "ABSENT",
  "LATE",
  "HALF_DAY",
  "LEAVE",
  "HOLIDAY",
  "COMPLETED",
  "IN_PROGRESS",
  "SCHEDULED",
  "UNMARKED"
] as const;

export const attendanceRowDtoSchema = z
  .object({
    id: idSchema,
    status: z.enum(ATTENDANCE_STATUSES)
  })
  .passthrough();
export type AttendanceRowDto = z.infer<typeof attendanceRowDtoSchema>;

export const attendanceListResponseDtoSchema = z.object({
  rows: z.array(attendanceRowDtoSchema),
  total: z.number().int().nonnegative()
});
export type AttendanceListResponseDto = z.infer<typeof attendanceListResponseDtoSchema>;

export const attendanceDeleteResultDtoSchema = z.object({
  id: idSchema
});
export type AttendanceDeleteResultDto = z.infer<typeof attendanceDeleteResultDtoSchema>;

const attendanceDerivedStatusSchema = z.enum(ATTENDANCE_DERIVED_STATUSES);

export const attendanceDayBoardSummaryDtoSchema = z.object({
  total: z.number().int().nonnegative(),
  scheduled: z.number().int().nonnegative(),
  present: z.number().int().nonnegative(),
  absent: z.number().int().nonnegative(),
  late: z.number().int().nonnegative(),
  half_day: z.number().int().nonnegative(),
  leave: z.number().int().nonnegative(),
  holiday: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  in_progress: z.number().int().nonnegative(),
  unmarked: z.number().int().nonnegative()
});
export type AttendanceDayBoardSummaryDto = z.infer<typeof attendanceDayBoardSummaryDtoSchema>;

export const attendanceDayBoardRowDtoSchema = z.object({
  key: z.string(),
  duty_id: z.string().nullable(),
  duty_status: z.string().nullable(),
  patient_id: z.string().nullable(),
  patient_name: z.string(),
  employee_id: idSchema,
  employee_name: z.string(),
  shift_type: z.string().nullable(),
  start_at: z.string().nullable(),
  end_at: z.string().nullable(),
  is_extra_partner: z.boolean(),
  attendance_id: z.string().nullable(),
  attendance_status: z.string().nullable(),
  check_in_at: z.string().nullable(),
  check_out_at: z.string().nullable(),
  hours: z.number(),
  notes: z.string(),
  derived_status: attendanceDerivedStatusSchema
});
export type AttendanceDayBoardRowDto = z.infer<typeof attendanceDayBoardRowDtoSchema>;

export const attendanceDayBoardDtoSchema = z.object({
  date: z.string(),
  rows: z.array(attendanceDayBoardRowDtoSchema),
  summary: attendanceDayBoardSummaryDtoSchema
});
export type AttendanceDayBoardDto = z.infer<typeof attendanceDayBoardDtoSchema>;

export const attendanceRangeBoardSummaryDtoSchema = attendanceDayBoardSummaryDtoSchema.extend({
  total_hours: z.number(),
  total_charge: z.number(),
  total_payout: z.number()
});
export type AttendanceRangeBoardSummaryDto = z.infer<typeof attendanceRangeBoardSummaryDtoSchema>;

export const attendanceRangeBoardRowDtoSchema = z.object({
  key: z.string(),
  date: z.string(),
  duty_id: z.string().nullable(),
  duty_status: z.string().nullable(),
  patient_id: z.string().nullable(),
  patient_name: z.string(),
  employee_id: idSchema,
  employee_name: z.string(),
  shift_type: z.string().nullable(),
  is_extra_partner: z.boolean(),
  attendance_id: z.string().nullable(),
  attendance_status: z.string().nullable(),
  check_in_at: z.string().nullable(),
  check_out_at: z.string().nullable(),
  hours: z.number(),
  charge: z.number(),
  payout: z.number(),
  notes: z.string(),
  derived_status: attendanceDerivedStatusSchema
});
export type AttendanceRangeBoardRowDto = z.infer<typeof attendanceRangeBoardRowDtoSchema>;

export const attendanceRangeBoardDtoSchema = z.object({
  from: z.string(),
  to: z.string(),
  rows: z.array(attendanceRangeBoardRowDtoSchema),
  summary: attendanceRangeBoardSummaryDtoSchema
});
export type AttendanceRangeBoardDto = z.infer<typeof attendanceRangeBoardDtoSchema>;

/** Duty rows returned by GET /attendance/missing — passthrough for legacy columns. */
export const attendanceMissingDutyRowDtoSchema = z.record(z.unknown());
export const attendanceMissingListDtoSchema = z.array(attendanceMissingDutyRowDtoSchema);
export type AttendanceMissingListDto = z.infer<typeof attendanceMissingListDtoSchema>;
