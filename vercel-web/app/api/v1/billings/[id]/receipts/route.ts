import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { BILLING_READ_ROLES, BILLING_RECEIVE_ROLES } from "@/lib/api/billingRoles";
import { withIdempotency } from "@/lib/api/idempotency";
import { billingService } from "@/services/billingService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = withAuth<Params>(async (_req: NextRequest, { params, actor }) => {
  requireRole(actor, [...BILLING_READ_ROLES]);
  const result = await billingService.listReceiptsForBilling(params.id, { actor });
  return respond(result);
});

export const POST = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, [...BILLING_RECEIVE_ROLES]);
  return withIdempotency(
    req,
    actor,
    { route: `POST /billings/${params.id}/receipts` },
    async () => {
      const body = await parseJsonBody(req);
      const result = await billingService.recordPayment(
        { ...(body as object), billing_id: params.id },
        { actor }
      );
      return respond(result, 201);
    }
  );
});
