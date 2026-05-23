import { z } from "zod";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { jsonOk, badRequest, serverError } from "@/lib/api/errors";
import { supabaseAdmin } from "@/lib/api/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Whitelist of buckets the CRM is allowed to upload into. Keep narrow so a
 * caller can't mint signed URLs for arbitrary storage paths.
 */
const ALLOWED_BUCKETS = new Set(["patient-documents", "employee-documents"]);

const bodySchema = z.object({
  bucket: z.string().trim().min(1),
  fileName: z.string().trim().min(1).max(255)
});

/** Strip path separators and weird characters, keep a useful extension. */
function sanitizeFileName(raw: string): string {
  const cleaned = raw
    .replace(/[\\/]/g, "_")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(-120);
  return cleaned || "file";
}

/** Per-day prefix keeps the bucket browsable in the Supabase dashboard. */
function buildObjectPath(fileName: string): string {
  const today = new Date().toISOString().slice(0, 10);
  // Use the Web Crypto API; available in the Node runtime on Vercel.
  const uniq = (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
  ).slice(0, 12);
  return `${today}/${uniq}-${sanitizeFileName(fileName)}`;
}

/**
 * POST /api/v1/uploads/signed-url
 *
 * Body: { bucket, fileName }
 * Returns: { path, token, signedUrl, bucket }
 *
 * The browser then calls `supabase.storage.from(bucket)
 *   .uploadToSignedUrl(path, token, file)` to PUT the bytes directly into
 * Storage without ever sending the file through our server.
 */
export const POST = withAuth(async (req) => {
  const raw = await parseJsonBody(req);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    throw badRequest("Invalid upload request", parsed.error.flatten());
  }
  const { bucket, fileName } = parsed.data;

  if (!ALLOWED_BUCKETS.has(bucket)) {
    throw badRequest(`Bucket '${bucket}' is not allowed for uploads`);
  }

  const path = buildObjectPath(fileName);
  const { data, error } = await supabaseAdmin()
    .storage.from(bucket)
    .createSignedUploadUrl(path);

  if (error || !data) {
    throw serverError(
      `Could not create signed upload URL: ${error?.message || "unknown error"}`
    );
  }

  return jsonOk({
    bucket,
    path: data.path,
    token: data.token,
    signedUrl: data.signedUrl
  });
});
