import { z } from "zod";
import { idSchema } from "@/validation/commonValidation";
import { INQUIRY_STATUSES } from "@/validation/inquiryValidation";

/**
 * Read-model contract for GET /inquiries/:id.
 *
 * `permissions` is the single source of truth for action gating in the UI —
 * close / convert / edit / reopen / hard-delete. New fields are additive
 * (passthrough on the row) so legacy clients remain compatible.
 */

export const inquiryPermissionsDtoSchema = z.object({
  canEdit: z.boolean(),
  canConvert: z.boolean(),
  canClose: z.boolean(),
  canReopen: z.boolean(),
  canDelete: z.boolean(),
  canHardDelete: z.boolean(),
  blockReasons: z.record(z.string(), z.string()).optional()
});
export type InquiryPermissionsDto = z.infer<typeof inquiryPermissionsDtoSchema>;

export const inquiryRowDtoSchema = z
  .object({
    id: idSchema,
    status: z.enum(INQUIRY_STATUSES)
  })
  .passthrough();
export type InquiryRowDto = z.infer<typeof inquiryRowDtoSchema>;

export const inquiryDetailDtoSchema = inquiryRowDtoSchema.extend({
  permissions: inquiryPermissionsDtoSchema
});
export type InquiryDetailDto = z.infer<typeof inquiryDetailDtoSchema>;

export const inquiryListResponseDtoSchema = z.object({
  rows: z.array(inquiryDetailDtoSchema),
  total: z.number().int().nonnegative()
});
export type InquiryListResponseDto = z.infer<typeof inquiryListResponseDtoSchema>;

export const inquiryRemoveResultDtoSchema = z.object({
  id: idSchema,
  mode: z.enum(["soft", "hard"])
});
export type InquiryRemoveResultDto = z.infer<typeof inquiryRemoveResultDtoSchema>;

export const inquiryConvertResultDtoSchema = z.object({
  patient_id: idSchema,
  inquiry_id: idSchema,
  inquiry: inquiryRowDtoSchema,
  alreadyConverted: z.boolean()
});
export type InquiryConvertResultDto = z.infer<typeof inquiryConvertResultDtoSchema>;

export function parseInquiryDetailDto(data: unknown) {
  return inquiryDetailDtoSchema.safeParse(data);
}
