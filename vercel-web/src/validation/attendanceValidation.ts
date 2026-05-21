import { z } from "zod";
import { idSchema, isoDate } from "@/validation/commonValidation";

export const attendanceSchema = z.object({
  id: idSchema.optional(),
  duty_id: z.string().optional(),
  employee_id: idSchema,
  patient_id: z.string().optional(),
  check_in_at: isoDate.optional(),
  check_out_at: isoDate.optional(),
  status: z.enum(["PRESENT", "ABSENT", "LATE", "HALF_DAY", "LEAVE"]).default("PRESENT"),
  notes: z.string().optional().default("")
});

export type AttendanceInput = z.infer<typeof attendanceSchema>;
