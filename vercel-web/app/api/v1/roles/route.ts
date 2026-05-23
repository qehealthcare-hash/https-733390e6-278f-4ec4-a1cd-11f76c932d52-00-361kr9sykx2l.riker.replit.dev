import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { jsonOk } from "@/lib/api/errors";
import { userService } from "@/lib/api/services/user.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (_req, { actor }) => {
  const data = await userService.listRoles(actor.accessToken);
  return jsonOk(data);
});

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin"]);
  const body = await parseJsonBody(req);
  const data = await userService.createRole(body);
  return jsonOk(data, 201);
});
