import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { requireRole } from "@/lib/api/auth";
import { billingService } from "@/lib/api/services/billing.service";
import { billingStatusSchema } from "@/validation/billingValidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const POST = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager", "Accountant"]);
  const body = await parseJsonBody(req);
  const input = billingStatusSchema.parse(body);
  const row = await billingService.updateStatus(params.id, input.status, actor);
  return jsonOk(row);
});
