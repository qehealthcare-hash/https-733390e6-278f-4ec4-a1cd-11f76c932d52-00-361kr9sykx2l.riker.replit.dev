import type { NextRequest } from "next/server";
import { z } from "zod";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { requireRole } from "@/lib/api/auth";
import { billingService } from "@/lib/api/services/billing.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ status: z.enum(["Active", "Closed", "Cancelled"]) });
type Params = { id: string };

export const POST = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager", "Accountant"]);
  const body = await parseJsonBody(req);
  const input = schema.parse(body);
  const row = await billingService.updateStatus(params.id, input.status, actor);
  return jsonOk(row);
});
