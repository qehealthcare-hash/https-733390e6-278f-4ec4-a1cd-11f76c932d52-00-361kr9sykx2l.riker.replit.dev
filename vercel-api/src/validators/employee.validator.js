import { z } from "zod";
import { phoneSchema } from "./common.js";

export const employeeSchema = z.object({
  full_name: z.string().min(2),
  mobile: phoneSchema,
  address: z.string().min(5),
  role: z.enum(["NURSE", "ATTENDANT", "STAFF", "ACCOUNTANT"]),
  education: z.enum(["ILLITERATE", "BELOW_10", "PASS_10_12", "GRADUATE"]),
  shift_type: z.enum(["DAY", "NIGHT", "24H"]),
  documents: z
    .array(
      z.object({
        bucket: z.string().min(1),
        path: z.string().min(1),
        file_name: z.string().min(1),
        mime_type: z.string().min(1)
      })
    )
    .min(1),
  active: z.boolean().default(true)
});
