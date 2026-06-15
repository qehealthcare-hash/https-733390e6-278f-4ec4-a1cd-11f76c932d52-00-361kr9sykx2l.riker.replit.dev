import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { BILLING_READ_ROLES } from "@/lib/api/billingRoles";
import { billingService } from "@/services/billingService";
import { respond, respondValidated } from "@/lib/api/apiResultBridge";
import { patientDutyLedgerDtoSchema } from "@/validation/billingDto";
import { ErrorCodes, type ApiResult } from "@/types/common";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/billings/ledger?patient_id=&period=YYYY-MM
 *
 * Live duty-calendar billing ledger for desync checks on the Billing screen.
 */
export const GET = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, [...BILLING_READ_ROLES]);
  const url = new URL(req.url);
  const patientId = String(url.searchParams.get("patient_id") || "").trim();
  const period = String(url.searchParams.get("period") || "").trim();
  if (!patientId) {
    const result: ApiResult<never> = {
      success: false,
      error: "patient_id is required",
      code: ErrorCodes.badRequest
    };
    return respond(result);
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    const result: ApiResult<never> = {
      success: false,
      error: "period must be YYYY-MM",
      code: ErrorCodes.badRequest
    };
    return respond(result);
  }
  const result = await billingService.patientDutyLedger(patientId, period, { actor });
  return respondValidated(result, patientDutyLedgerDtoSchema);
});
