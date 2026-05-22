import { withAuth } from "@/lib/api/handler";
import { billingService } from "@/services/billingService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * GET /api/v1/billings/[id]/invoice
 *
 * Returns the canonical invoice payload (billing + services + receipts +
 * totals + derived period). The UI renders this into PDF client-side;
 * totals come from the server so dashboards and printouts match.
 */
export const GET = withAuth<Params>(async (_req, { params, actor }) => {
  const result = await billingService.invoicePayload(params.id, { actor });
  return respond(result);
});
