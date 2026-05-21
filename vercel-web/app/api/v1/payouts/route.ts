import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody, pageParams } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { requireRole } from "@/lib/api/auth";
import { payoutService, payoutSchema } from "@/lib/api/services/payout.service";
import { withIdempotency } from "@/lib/api/idempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: NextRequest) => {
  const url = new URL(req.url);
  const result = await payoutService.list({
    ...pageParams(req),
    period: url.searchParams.get("period") || undefined,
    employeeId: url.searchParams.get("employee_id") || undefined,
    status: url.searchParams.get("status") || undefined
  });
  return jsonOk(result);
});

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Manager", "Accountant"]);
  return withIdempotency(req, actor, { route: "POST /payouts" }, async () => {
    const body = await parseJsonBody(req);
    const input = payoutSchema.parse(body);
    const row = await payoutService.ensure(input, actor);
    return jsonOk(row, 201);
  });
});
