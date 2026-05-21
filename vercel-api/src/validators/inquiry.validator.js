import { z } from "zod";
import { phoneSchema } from "./common.js";

export const inquirySchema = z.object({
  patient_name: z.string().min(2),
  mobile: phoneSchema,
  area: z.string().min(2),
  city: z.string().min(2).default("Ahmedabad"),
  service_required: z.string().min(2),
  source: z.enum([
    "FACEBOOK",
    "INSTAGRAM",
    "JUST_DIAL",
    "WALK_IN",
    "WEBSITE",
    "INDIAMART",
    "WHATSAPP",
    "GOOGLE_ADS",
    "YOUTUBE",
    "DOCTOR_REFERRAL",
    "PATIENT_REFERRAL",
    "WORD_OF_MOUTH",
    "OTHER_SOCIAL",
    "OTHER"
  ]),
  potential: z.enum(["HOT", "WARM", "COLD"]).default("WARM"),
  emergency_level: z.coerce.number().min(1).max(10),
  flexibility_score: z.coerce.number().min(1).max(10),
  priority_score: z.coerce.number().min(1).max(10),
  notes: z.string().optional().default("")
});
