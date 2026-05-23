import { request } from "./api-client";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — matches storage.buckets.file_size_limit
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf"
]);

function humaniseBytes(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
  return bytes + " B";
}

/**
 * Two-step upload:
 *   1) ask /api/v1/uploads/signed-url for a server-signed upload token
 *      (admin-only path generation, bucket whitelist, sanitized file name)
 *   2) PUT the bytes directly to Supabase Storage via uploadToSignedUrl
 *
 * Returns a stable shape the row mappers persist on hh_patients /
 * hh_employees: { bucket, path, file_name, mime_type }.
 */
export async function uploadDocument(options) {
  if (!options || !options.file) {
    throw new Error("No file selected");
  }
  if (!options.bucket) {
    throw new Error("Upload bucket not specified");
  }
  if (!options.session?.access_token) {
    throw new Error("You must be signed in to upload files");
  }
  if (!options.supabase) {
    throw new Error("Supabase client unavailable for upload");
  }

  var file = options.file;
  var mime = file.type || "application/octet-stream";

  if (file.size > MAX_BYTES) {
    throw new Error(
      "File '" +
        file.name +
        "' is " +
        humaniseBytes(file.size) +
        " — limit is " +
        humaniseBytes(MAX_BYTES)
    );
  }
  if (mime !== "application/octet-stream" && !ALLOWED_MIME.has(mime)) {
    throw new Error(
      "File type '" + mime + "' is not allowed. Use JPG, PNG, WebP, HEIC, or PDF."
    );
  }

  var signed;
  try {
    signed = await request(
      "/uploads/signed-url",
      {
        method: "POST",
        body: { bucket: options.bucket, fileName: file.name }
      },
      options.session
    );
  } catch (err) {
    var serverMessage = err?.message || "could not get upload URL";
    throw new Error("Upload could not start: " + serverMessage);
  }

  if (!signed || !signed.path || !signed.token) {
    throw new Error("Upload service returned an invalid signed URL");
  }

  var uploadResult;
  try {
    uploadResult = await options.supabase.storage
      .from(options.bucket)
      .uploadToSignedUrl(signed.path, signed.token, file, {
        contentType: mime,
        upsert: true
      });
  } catch (err) {
    throw new Error("Upload failed: " + (err?.message || "network error"));
  }

  if (uploadResult?.error) {
    throw new Error("Upload failed: " + (uploadResult.error.message || "unknown error"));
  }

  return {
    bucket: options.bucket,
    path: signed.path,
    file_name: file.name,
    mime_type: mime,
    size: file.size,
    uploaded_at: new Date().toISOString()
  };
}
