import { withAuth } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { billingService } from "@/lib/api/services/billing.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * Returns the invoice payload (billing + patient + services + receipts + totals).
 * The legacy CRM and the React UI render this into a PDF client-side using the
 * existing jsPDF templates — no need to pin a server-side PDF renderer here.
 */
export const GET = withAuth<Params>(async (_req, { params }) => {
  const payload = await billingService.invoicePayload(params.id);
  return jsonOk(payload);
});
