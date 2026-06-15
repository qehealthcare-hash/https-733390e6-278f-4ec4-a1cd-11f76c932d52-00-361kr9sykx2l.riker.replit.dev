import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { billingService } from "@/services/billingService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { billingSummaryDtoSchema } from "@/validation/billingDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * POST /api/v1/billings/[id]/reopen
 *
 * Reopens a Closed bill. Requires `reason` (audited). Refuses if the
 * patient already has another Active bill (would violate
 * `uq_hh_billings_patient_active`).
 *
 * Body: `{ reason: string }` (required)
 */
export const POST = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager"]);
  const body = await parseJsonBody(req);
  const result = await billingService.reopen(params.id, body, { actor });
  return respondValidated(result, billingSummaryDtoSchema);
});
