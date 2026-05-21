import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { requireRole } from "@/lib/api/auth";
import { payoutService, payoutAdjustmentSchema } from "@/lib/api/services/payout.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Accountant"]);
  const body = await parseJsonBody(req);
  const input = payoutAdjustmentSchema.parse(body);
  const row = await payoutService.adjust(input, actor);
  return jsonOk(row);
});
