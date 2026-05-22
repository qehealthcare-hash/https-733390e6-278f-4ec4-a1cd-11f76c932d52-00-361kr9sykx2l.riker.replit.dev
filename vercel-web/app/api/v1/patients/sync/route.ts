import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { withIdempotency } from "@/lib/api/idempotency";
import { patientService } from "@/services/patientService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/patients/sync
 *
 * Legacy SPA upsert — accepts the `toSbPatient()` column set (legacy status
 * enum, photo/docs blobs) and routes through `patientService.syncLegacy`.
 * Insert when the row id is missing/new; update otherwise.
 */
export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Manager", "Staff", "Executive"]);
  return withIdempotency(req, actor, { route: "POST /patients/sync" }, async () => {
    const body = await parseJsonBody(req);
    const result = await patientService.syncLegacy(body, { actor });
    return respond(result);
  });
});
