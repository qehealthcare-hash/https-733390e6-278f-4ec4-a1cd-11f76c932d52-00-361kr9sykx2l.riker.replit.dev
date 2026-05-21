import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { requireRole } from "@/lib/api/auth";
import { billingService, generateFromDutySchema } from "@/lib/api/services/billing.service";
import { withIdempotency } from "@/lib/api/idempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Manager", "Accountant"]);
  return withIdempotency(req, actor, { route: "POST /billings/generate" }, async () => {
    const body = await parseJsonBody(req);
    const input = generateFromDutySchema.parse(body);
    const result = await billingService.generateFromDuty(input, actor);
    return jsonOk(result, 201);
  });
});
