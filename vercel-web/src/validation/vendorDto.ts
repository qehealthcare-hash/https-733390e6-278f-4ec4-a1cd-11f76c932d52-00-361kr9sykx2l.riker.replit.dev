import { z } from "zod";
import { idSchema } from "@/validation/commonValidation";

export const vendorRowDtoSchema = z
  .object({
    id: idSchema,
    name: z.string()
  })
  .passthrough();
export type VendorRowDto = z.infer<typeof vendorRowDtoSchema>;

export const vendorListResponseDtoSchema = z.object({
  rows: z.array(vendorRowDtoSchema),
  total: z.number().int().nonnegative()
});
export type VendorListResponseDto = z.infer<typeof vendorListResponseDtoSchema>;

export const vendorDeleteResultDtoSchema = z.object({
  id: idSchema,
  deleted: z.literal(true)
});
export type VendorDeleteResultDto = z.infer<typeof vendorDeleteResultDtoSchema>;
