import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { requireRole } from "@/lib/api/auth";
import { whatsappService, sendTextSchema } from "@/lib/api/services/whatsapp.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Manager", "Staff"]);
  const body = await parseJsonBody(req);
  const input = sendTextSchema.parse(body);
  const result = await whatsappService.sendText(input, actor);
  return jsonOk(result);
});
