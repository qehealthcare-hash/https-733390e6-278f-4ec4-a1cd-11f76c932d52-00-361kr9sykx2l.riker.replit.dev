import { z } from "zod";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { jsonOk, badRequest, serverError, forbidden } from "@/lib/api/errors";
import { supabaseAdmin } from "@/lib/api/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_BUCKETS = new Set(["patient-documents", "employee-documents"]);

/**
 * Read-only roles allowed to mint signed URLs. Mirrors patient/employee read
 * RBAC: everyone with a CRM seat can view documents linked to records they
 * can already list. Tightened at audit time — was previously open to any
 * authenticated user, including roles that should not see PII.
 */
const READ_ROLES = new Set(["Admin", "Manager", "Staff", "Executive", "Nurse"]);

const bodySchema = z.object({
  bucket: z.string().trim().min(1),
  path: z.string().trim().min(1).max(512),
  /** Seconds; capped at 1 hour. */
  expires_in: z.coerce.number().int().min(30).max(3600).optional().default(600),
  /** Force browser download with this name (otherwise opens inline). */
  download_as: z.string().trim().max(255).optional()
});

/**
 * Defensive path check: every legitimate upload from this CRM is keyed by
 * `<entity>/<id>/<filename>` (see `/api/v1/uploads`). Paths that try to
 * escape the bucket via `..`, leading slash, or backslash are rejected.
 */
function isSafeObjectPath(path: string): boolean {
  if (!path) return false;
  if (path.startsWith("/") || path.startsWith("\\")) return false;
  const segments = path.split("/");
  for (const seg of segments) {
    if (!seg || seg === "." || seg === "..") return false;
  }
  return true;
}

/**
 * POST /api/v1/uploads/signed-download
 *
 * Mints a short-lived read URL for a Storage object that the CRM persisted on
 * a patient/employee row. Bucket allow-list mirrors the upload route so a
 * caller cannot read arbitrary storage paths.
 */
export const POST = withAuth(async (req, { actor }) => {
  const role = String(actor?.role || "");
  if (!READ_ROLES.has(role)) {
    throw forbidden("Role not allowed to download documents");
  }

  const raw = await parseJsonBody(req);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    throw badRequest("Invalid download request", parsed.error.flatten());
  }
  const { bucket, path, expires_in, download_as } = parsed.data;

  if (!ALLOWED_BUCKETS.has(bucket)) {
    throw badRequest(`Bucket '${bucket}' is not allowed`);
  }
  if (!isSafeObjectPath(path)) {
    throw badRequest("Object path is not allowed");
  }

  const { data, error } = await supabaseAdmin()
    .storage.from(bucket)
    .createSignedUrl(path, expires_in, download_as ? { download: download_as } : undefined);

  if (error || !data?.signedUrl) {
    throw serverError(
      `Could not create signed download URL: ${error?.message || "unknown error"}`
    );
  }

  return jsonOk({ bucket, path, signedUrl: data.signedUrl, expires_in });
});
