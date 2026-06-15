import { z } from "zod";

export const signedUploadUrlDtoSchema = z.object({
  bucket: z.string(),
  path: z.string(),
  token: z.string(),
  signedUrl: z.string()
});
export type SignedUploadUrlDto = z.infer<typeof signedUploadUrlDtoSchema>;

export const signedDownloadUrlDtoSchema = z.object({
  bucket: z.string(),
  path: z.string(),
  signedUrl: z.string(),
  expires_in: z.number()
});
export type SignedDownloadUrlDto = z.infer<typeof signedDownloadUrlDtoSchema>;
