import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { withIdempotency } from "@/lib/api/idempotency";
import { billingService } from "@/services/billingService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { receiptOrNullDtoSchema } from "@/validation/billingDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string; receiptId: string };

/**
 * Soft-deletes a receipt via `hominal_soft_delete_receipt`.
 *
 * Body is optional `{ reason?: string }` — recorded in the audit log.
 * The bill must be editable (Active); closed/cancelled bills reject.
 */
export const DELETE = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager", "Accountant"]);
  return withIdempotency(
    req,
    actor,
    { route: `DELETE /billings/${params.id}/receipts/${params.receiptId}` },
    async () => {
      let reason = "";
      try {
        const body = await parseJsonBody<{ reason?: string }>(req);
        reason = String(body?.reason || "").trim();
      } catch {
        reason = "";
      }
      const result = await billingService.softDeleteReceipt(
        params.id,
        params.receiptId,
        { actor },
        reason
      );
      return respondValidated(result, receiptOrNullDtoSchema);
    }
  );
});
