import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { requireRole } from "@/lib/api/auth";
import { billingService, receiptSchema } from "@/lib/api/services/billing.service";
import { withIdempotency } from "@/lib/api/idempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const POST = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager", "Accountant", "Staff"]);
  return withIdempotency(req, actor, { route: `POST /billings/${params.id}/receipts` }, async () => {
    const body = await parseJsonBody(req);
    const input = receiptSchema.parse({ ...body, billing_id: params.id });
    const result = await billingService.recordPayment(input, actor);
    return jsonOk(result, 201);
  });
});
