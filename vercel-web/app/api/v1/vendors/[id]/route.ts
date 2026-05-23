import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { jsonOk } from "@/lib/api/errors";
import { vendorService } from "@/lib/api/services/vendor.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = withAuth<Params>(async (_req: NextRequest, { params, actor }) => {
  const data = await vendorService.get(params.id, actor.accessToken);
  return jsonOk(data);
});

export const PATCH = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager", "Accountant"]);
  const body = await parseJsonBody(req);
  const data = await vendorService.update(params.id, body, actor.accessToken);
  return jsonOk(data);
});

export const PUT = PATCH;

export const DELETE = withAuth<Params>(async (_req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin"]);
  const data = await vendorService.remove(params.id, actor.accessToken);
  return jsonOk(data);
});
