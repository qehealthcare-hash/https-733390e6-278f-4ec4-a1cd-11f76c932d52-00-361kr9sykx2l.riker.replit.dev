import { request } from "./api-client";

export async function uploadDocument(options) {
  var signed = await request(
    "/uploads/signed-url",
    {
      method: "POST",
      body: {
        bucket: options.bucket,
        fileName: options.file.name
      }
    },
    options.session
  );

  var uploadResult = await options.supabase.storage
    .from(options.bucket)
    .uploadToSignedUrl(signed.path, signed.token, options.file, {
      contentType: options.file.type || "application/octet-stream",
      upsert: true
    });

  if (uploadResult.error) {
    throw uploadResult.error;
  }

  return {
    bucket: options.bucket,
    path: signed.path,
    file_name: options.file.name,
    mime_type: options.file.type || "application/octet-stream"
  };
}
