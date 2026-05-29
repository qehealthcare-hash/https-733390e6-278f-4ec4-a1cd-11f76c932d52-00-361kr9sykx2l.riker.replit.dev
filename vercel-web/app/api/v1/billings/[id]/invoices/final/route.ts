import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { withIdempotency } from "@/lib/api/idempotency";
import { billingService } from "@/services/billingService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * POST /api/v1/billings/[id]/invoices/final
 *   body: { notes?: string }
 *
 * Generates a FINAL invoice that closes the loop with the security deposit:
 *  - snapshots all unbilled svc entries on the bill
 *  - appends a "Security Deposit Adjustment" credit line
 *  - auto-creates a Refund receipt for any deposit excess
 *  - zeroes hh_billings.sec_dep
 * Idempotent — one non-cancelled FINAL invoice per billing.
 */
export const POST = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager", "Accountant"]);
  return withIdempotency(
    req,
    actor,
    { route: `POST /billings/${params.id}/invoices/final` },
    async () => {
      const body = await parseJsonBody(req);
      const result = await billingService.generateFinalInvoice(
        { ...(body as object), billing_id: params.id },
        { actor }
      );
      return respond(result, 201);
    }
  );
});
