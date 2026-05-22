import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { jsonOk } from "@/lib/api/errors";
import { userService } from "@/lib/api/services/user.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Manager"]);
  const url = new URL(req.url);
  const data = await userService.listUsers({
    q: url.searchParams.get("q") || undefined,
    role: url.searchParams.get("role") || undefined,
    active: url.searchParams.get("active") || undefined,
    limit: Number(url.searchParams.get("limit") || 200),
    offset: Number(url.searchParams.get("offset") || 0)
  });
  return jsonOk(data);
});

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin"]);
  const body = await parseJsonBody(req);
  const data = await userService.createUser(body);
  return jsonOk(data, 201);
});
