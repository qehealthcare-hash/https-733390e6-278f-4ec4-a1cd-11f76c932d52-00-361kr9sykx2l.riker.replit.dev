import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { jsonOk } from "@/lib/api/errors";
import { settingsService } from "@/lib/api/services/settings.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { key: string };

export const GET = withAuth<Params>(async (_req: NextRequest, { params }) => {
  const value = await settingsService.getKey(params.key);
  return jsonOk({ key: params.key, value });
});

export const PUT = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager"]);
  const body = await parseJsonBody(req);
  const value = body && Object.prototype.hasOwnProperty.call(body, "value") ? (body as { value: unknown }).value : body;
  const data = await settingsService.setKey(params.key, value);
  return jsonOk(data);
});

export const DELETE = withAuth<Params>(async (_req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin"]);
  const data = await settingsService.deleteKey(params.key);
  return jsonOk(data);
});
