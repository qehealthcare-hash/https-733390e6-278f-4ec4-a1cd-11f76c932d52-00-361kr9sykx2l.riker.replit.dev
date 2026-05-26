import { z } from "zod";
import { optionalEmail } from "@/validation/commonValidation";

const trimmed = z.preprocess(
  (v) => (v == null ? "" : String(v).trim()),
  z.string()
);

export const vendorCreateSchema = z
  .object({
    name: trimmed.refine((v) => v.length > 0, "Vendor name is required"),
    contact: trimmed.optional(),
    phone: trimmed.optional(),
    email: optionalEmail.optional(),
    gst: trimmed.optional(),
    pan: trimmed.optional(),
    addr: trimmed.optional(),
    city: trimmed.optional()
  })
  .passthrough();

export const vendorPatchSchema = vendorCreateSchema.partial();

export type VendorCreateInput = z.infer<typeof vendorCreateSchema>;
export type VendorPatchInput = z.infer<typeof vendorPatchSchema>;
