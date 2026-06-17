import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { BILLING_READ_ROLES } from "@/lib/api/billingRoles";
import { billingService } from "@/services/billingService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import {
  billingListResponseDtoSchema,
  billingPatientHistoryDtoSchema,
  billingRowDtoSchema
} from "@/validation/billingDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/billings
 *
 * - With `?patient_id=` only: returns the patient's full billing history bundle
 *   (`{ billings, receipts, services, totalsByBilling }`) for legacy ledger views.
 * - With `?patient_id=` plus list filters (`limit`, `status`, `period`, …): paginated
 *   list scoped to that patient (fast path for duty calendar outstanding lookups).
 * - Without `patient_id`: paginated list across all billings.
 */
export const GET = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, [...BILLING_READ_ROLES]);
  const url = new URL(req.url);
  const patientId = url.searchParams.get("patient_id");
  const wantsHistoryBundle =
    Boolean(patientId) &&
    (url.searchParams.get("bundle") === "1" ||
      (!url.searchParams.has("limit") &&
        !url.searchParams.has("offset") &&
        !url.searchParams.has("q") &&
        !url.searchParams.has("status") &&
        !url.searchParams.has("period")));
  if (patientId && wantsHistoryBundle) {
    const result = await billingService.listByPatient(patientId, { actor });
    return respondValidated(result, billingPatientHistoryDtoSchema);
  }
  const query = {
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    patient_id: patientId ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    period: url.searchParams.get("period") ?? undefined
  };
  const result = await billingService.list(query, { actor });
  return respondValidated(result, billingListResponseDtoSchema);
});

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Manager", "Accountant"]);
  const body = await parseJsonBody(req);
  const result = await billingService.create(body, { actor });
  return respondValidated(result, billingRowDtoSchema, 201);
});
