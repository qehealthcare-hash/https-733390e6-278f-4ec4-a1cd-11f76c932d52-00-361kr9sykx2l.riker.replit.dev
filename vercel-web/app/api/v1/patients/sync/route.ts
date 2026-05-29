import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { PATIENT_SYNC_ROLES } from "@/business/rbac";
import { withIdempotency } from "@/lib/api/idempotency";
import { patientService } from "@/services/patientService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/patients/sync
 *
 * **Legacy quarantine (M5-G):** still required by `public/lib/legacy-api.js`
 * (`HominalApi.patients.sync` → `toSbPatient()` upserts with client ids).
 * Do not remove until the legacy SPA is fully retired. The modern Next.js
 * patients page uses `POST /patients` and `PUT /patients/:id` instead.
 * Access is Admin/Manager-only (`PATIENT_SYNC_ROLES`).
 *
 * Routes through `patientService.syncLegacy` (audited, RLS-scoped).
 */
export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, PATIENT_SYNC_ROLES);
  return withIdempotency(req, actor, { route: "POST /patients/sync" }, async () => {
    const body = await parseJsonBody(req);
    const result = await patientService.syncLegacy(body, { actor });
    return respond(result);
  });
});
