import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { requireRole } from "@/lib/api/auth";
import { payoutService, payoutPaySchema } from "@/lib/api/services/payout.service";
import { withIdempotency } from "@/lib/api/idempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Accountant"]);
  return withIdempotency(req, actor, { route: "POST /payouts/pay" }, async () => {
    const body = await parseJsonBody(req);
    const input = payoutPaySchema.parse(body);
    const row = await payoutService.markPaid(input, actor);
    return jsonOk(row);
  });
});
