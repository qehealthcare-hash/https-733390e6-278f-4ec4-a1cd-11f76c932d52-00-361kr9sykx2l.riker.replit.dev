import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { BILLING_WRITE_ROLES } from "@/lib/api/billingRoles";
import { billingService } from "@/services/billingService";
import { respond, respondValidated } from "@/lib/api/apiResultBridge";
import { dutyLedgerSyncSummaryDtoSchema } from "@/validation/billingDto";
import { failure } from "@/utils/apiResponse";
import { ErrorCodes } from "@/types/common";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/v1/billings/duty-ledger-sync
 *
 * Materialize every billable duty for a patient into their Active bill,
 * then run hominal_dedup_billing_diary. Called from the duty calendar when
 * a patient filter is active so billing row counts match painted cells.
 */
export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, [...BILLING_WRITE_ROLES]);
  const body = (await parseJsonBody(req)) as { patient_id?: string };
  const patientId = String(body?.patient_id || "").trim();
  if (!patientId) {
    return respond(failure("patient_id is required", ErrorCodes.validation));
  }
  const result = await billingService.syncDutyLedgerForPatient(patientId, { actor });
  return respondValidated(result, dutyLedgerSyncSummaryDtoSchema);
});
