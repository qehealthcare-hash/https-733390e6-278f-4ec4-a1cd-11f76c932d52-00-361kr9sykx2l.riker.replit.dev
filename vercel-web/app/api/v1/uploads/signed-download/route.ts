import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { toServiceContext } from "@/lib/api/serviceContext";
import { respond } from "@/lib/api/apiResultBridge";
import { storageService } from "@/services/storageService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/uploads/signed-download
 *
 * Mints a short-lived read URL for a Storage object that the CRM persisted on
 * a patient/employee row. Bucket allow-list and "path linked to a record"
 * check live in `storageService`.
 *
 * Defence in depth: the route gates by role BEFORE reaching the service.
 * Previously the only RBAC was inside the service, which meant a future
 * code path that called the service without first checking actor role
 * could leak signed URLs.
 */
export const POST = withAuth(async (req, { actor }) => {
  requireRole(actor, ["Admin", "Manager", "Accountant", "Staff", "Executive", "Nurse"]);
  const body = await parseJsonBody(req);
  const result = await storageService.createSignedDownload(body, toServiceContext(actor));
  return respond(result);
});
