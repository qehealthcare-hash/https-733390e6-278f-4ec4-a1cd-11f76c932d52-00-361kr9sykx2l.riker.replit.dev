import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { UPLOAD_WRITE_ROLES } from "@/lib/api/crmRoles";
import { toServiceContext } from "@/lib/api/serviceContext";
import { respond } from "@/lib/api/apiResultBridge";
import { storageService } from "@/services/storageService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
export const POST = withAuth(async (req, { actor }) => {
  requireRole(actor, [...UPLOAD_WRITE_ROLES]);
  const body = await parseJsonBody(req);
  const result = await storageService.createSignedUpload(body, toServiceContext(actor));
  return respond(result);
});
