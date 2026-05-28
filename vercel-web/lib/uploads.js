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
        // P1-35: include mime so the server can validate against its
        // z.enum allow-list. The client already screens against
        // ALLOWED_MIME above; the server re-checks because the client
        // is not the source of truth.
        body: { bucket: options.bucket, fileName: file.name, mime: mime }
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

/**
 * Mint a short-lived read URL for an uploaded document/photo.
 * Returns `{ signedUrl, bucket, path }` or null if the doc is incomplete.
 */
export async function getDocumentSignedUrl(doc, session, opts) {
  if (!doc || !doc.bucket || !doc.path) return null;
  if (!session?.access_token) {
    throw new Error("Sign in to view this document");
  }
  var body = {
    bucket: doc.bucket,
    path: doc.path,
    expires_in: (opts && opts.expiresIn) || 600
  };
  if (opts && opts.download && doc.file_name) {
    body.download_as = doc.file_name;
  }
  var data = await request(
    "/uploads/signed-download",
    { method: "POST", body: body },
    session
  );
  return data && data.signedUrl ? data : null;
}

export function isImageDocument(doc) {
  if (!doc) return false;
  var mime = String(doc.mime_type || "").toLowerCase();
  if (mime.indexOf("image/") === 0) return true;
  var name = String(doc.file_name || doc.path || "").toLowerCase();
  return /\.(jpe?g|png|webp|heic|heif|gif)$/.test(name);
}

export function isPdfDocument(doc) {
  if (!doc) return false;
  if (String(doc.mime_type || "").toLowerCase() === "application/pdf") return true;
  var name = String(doc.file_name || doc.path || "").toLowerCase();
  return /\.pdf$/.test(name);
}
