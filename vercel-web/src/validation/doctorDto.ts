import { z } from "zod";
import { idSchema } from "@/validation/commonValidation";

export const doctorRowDtoSchema = z
  .object({
    id: idSchema,
    full_name: z.string()
  })
  .passthrough();
export type DoctorRowDto = z.infer<typeof doctorRowDtoSchema>;

export const doctorListResponseDtoSchema = z.object({
  rows: z.array(doctorRowDtoSchema),
  total: z.number().int().nonnegative()
});
export type DoctorListResponseDto = z.infer<typeof doctorListResponseDtoSchema>;

export const doctorDeleteResultDtoSchema = z.object({
  id: idSchema,
  deleted: z.literal(true)
});
export type DoctorDeleteResultDto = z.infer<typeof doctorDeleteResultDtoSchema>;
