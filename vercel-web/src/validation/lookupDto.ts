import { z } from "zod";
import { idSchema } from "@/validation/commonValidation";

export const patientLookupRowDtoSchema = z
  .object({
    id: idSchema,
    name: z.string()
  })
  .passthrough();
export type PatientLookupRowDto = z.infer<typeof patientLookupRowDtoSchema>;

export const patientLookupListDtoSchema = z.array(patientLookupRowDtoSchema);
export type PatientLookupListDto = z.infer<typeof patientLookupListDtoSchema>;

export const employeeLookupRowDtoSchema = z
  .object({
    id: idSchema,
    full_name: z.string()
  })
  .passthrough();
export type EmployeeLookupRowDto = z.infer<typeof employeeLookupRowDtoSchema>;

export const employeeLookupListDtoSchema = z.array(employeeLookupRowDtoSchema);
export type EmployeeLookupListDto = z.infer<typeof employeeLookupListDtoSchema>;

/** Service catalog entries — shape varies; validate as unknown records. */
export const serviceLookupListDtoSchema = z.array(z.record(z.unknown()));
export type ServiceLookupListDto = z.infer<typeof serviceLookupListDtoSchema>;

export const roleLookupRowDtoSchema = z
  .object({
    id: idSchema,
    name: z.string()
  })
  .passthrough();
export type RoleLookupRowDto = z.infer<typeof roleLookupRowDtoSchema>;

export const roleLookupListDtoSchema = z.array(roleLookupRowDtoSchema);
export type RoleLookupListDto = z.infer<typeof roleLookupListDtoSchema>;
