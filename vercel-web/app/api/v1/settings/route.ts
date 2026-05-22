import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { jsonOk } from "@/lib/api/errors";
import { settingsService } from "@/lib/api/services/settings.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  const data = await settingsService.listAll();
  return jsonOk(data);
});

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Manager"]);
  const body = await parseJsonBody(req);
  const data = await settingsService.bulkSet(body);
  return jsonOk(data);
});
