import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { requireRole } from "@/lib/api/auth";
import { aiService, askSchema } from "@/lib/api/services/ai.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  // H2: financial / payout context must be admin-only; lower roles can still query
  // patient/duty scopes but financial data is auto-filtered in ai.service.
  requireRole(actor, ["Admin", "Manager", "Accountant", "Staff"]);
  const body = await parseJsonBody(req);
  const input = askSchema.parse(body);
  const result = await aiService.ask(input, actor);
  return jsonOk(result);
});
