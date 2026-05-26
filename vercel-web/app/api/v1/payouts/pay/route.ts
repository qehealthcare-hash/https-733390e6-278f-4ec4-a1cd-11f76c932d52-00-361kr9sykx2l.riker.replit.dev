import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { withIdempotency } from "@/lib/api/idempotency";
import { payoutService } from "@/services/payoutService";
import { respond } from "@/lib/api/apiResultBridge";
import { parseInput } from "@/validation/parseValidation";
import { payoutPaySchema } from "@/validation/payoutValidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Accountant"]);
  return withIdempotency(req, actor, { route: "POST /payouts/pay" }, async () => {
    const body = await parseJsonBody(req);
    const parsed = parseInput(payoutPaySchema, body);
    if (!parsed.success) return respond(parsed);
    const result = await payoutService.markPaid(parsed.data, { actor });
    return respond(result);
  });
});
