import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { requireRole } from "@/lib/api/auth";
import { whatsappService, sendTemplateSchema } from "@/lib/api/services/whatsapp.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Manager", "Staff"]);
  const body = await parseJsonBody(req);
  const input = sendTemplateSchema.parse(body);
  const result = await whatsappService.sendTemplate(input, actor);
  return jsonOk(result);
});
