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
 * - With `?patient_id=`: returns the patient's full billing history bundle
 *   (`{ billings, receipts, services, totalsByBilling }`) so the UI can
 *   render the whole ledger from a single refetch.
 * - Without `patient_id`: paginated list across all billings.
 */
export const GET = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, [...BILLING_READ_ROLES]);
  const url = new URL(req.url);
  const patientId = url.searchParams.get("patient_id");
  if (patientId) {
    const result = await billingService.listByPatient(patientId, { actor });
    return respondValidated(result, billingPatientHistoryDtoSchema);
  }
  const query = {
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
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
