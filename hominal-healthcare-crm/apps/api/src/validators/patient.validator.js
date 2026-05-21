import { z } from "zod";
import { phoneSchema } from "./common.js";

const optionalStaffId = z.preprocess(function staffIdEmptyToNull(value) {
  return value === "" || value === undefined ? null : value;
}, z.union([z.string().uuid(), z.string().min(2).max(80)]).nullable().optional());

export const patientSchema = z.object({
  full_name: z.string().min(2),
  age: z.coerce.number().min(0).max(130),
  gender: z.enum(["Male", "Female", "Other"]),
  address: z
    .string()
    .max(500)
    .optional()
    .nullable()
    .transform(function (value) {
      return value ? value.trim() : "";
    }),
  area: z.string().min(2),
  city: z.string().min(2).default("Ahmedabad"),
  pincode: z.string().min(6).max(6),
  mobile: phoneSchema,
  disease_condition: z.string().min(2),
  assigned_staff_id: optionalStaffId,
  shift_type: z.enum(["DAY", "NIGHT", "24H"]),
  start_date: z.string(),
  status: z.enum(["ACTIVE", "CLOSED"]).default("ACTIVE"),
  close_reason: z.string().nullable().optional(),
  documents: z
    .array(
      z.object({
        bucket: z.string().min(1),
        path: z.string().min(1),
        file_name: z.string().min(1),
        mime_type: z.string().min(1)
      })
    )
    .optional()
    .default([]),
  relative_contacts: z
    .array(
      z.object({
        name: z.string().min(2),
        phone: phoneSchema
      })
    )
    .max(3)
    .default([])
});
