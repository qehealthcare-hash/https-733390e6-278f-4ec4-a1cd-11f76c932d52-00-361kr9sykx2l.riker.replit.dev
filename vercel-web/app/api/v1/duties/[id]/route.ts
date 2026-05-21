import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { requireRole } from "@/lib/api/auth";
import { dutyService, dutySchema } from "@/lib/api/services/duty.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = withAuth<Params>(async (_req, { params }) => {
  const row = await dutyService.getById(params.id);
  return jsonOk(row);
});

export const PATCH = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager", "Staff"]);
  const body = await parseJsonBody(req);
  const input = dutySchema.parse({ ...body, id: params.id });
  const row = await dutyService.update(params.id, input, actor);
  return jsonOk(row);
});

export const PUT = PATCH;

export const DELETE = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager"]);
  const reason = new URL(req.url).searchParams.get("reason") || "";
  const result = await dutyService.cancel(params.id, reason, actor);
  return jsonOk(result);
});
