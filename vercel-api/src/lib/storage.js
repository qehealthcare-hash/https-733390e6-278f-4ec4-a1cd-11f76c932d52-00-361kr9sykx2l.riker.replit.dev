import { supabaseAdmin } from "./supabase.js";
import { HttpError } from "./http-error.js";

export async function createSignedUploadUrl(bucket, objectPath) {
  const result = await supabaseAdmin.storage.from(bucket).createSignedUploadUrl(objectPath);
  if (result.error) {
    throw new HttpError(500, result.error.message);
  }
  return result.data;
}

export async function createSignedDownloadUrl(bucket, objectPath, expiresIn) {
  const result = await supabaseAdmin.storage.from(bucket).createSignedUrl(objectPath, expiresIn || 3600);
  if (result.error) {
    throw new HttpError(500, result.error.message);
  }
  return result.data;
}
