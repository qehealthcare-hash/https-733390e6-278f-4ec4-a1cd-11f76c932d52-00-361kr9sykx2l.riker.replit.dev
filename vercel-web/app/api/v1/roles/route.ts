import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { toServiceContext } from "@/lib/api/serviceContext";
import { respond } from "@/lib/api/apiResultBridge";
import { userService } from "@/services/userService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (_req, { actor }) => {
  const result = await userService.listRoles(toServiceContext(actor));
  return respond(result);
});

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin"]);
  const body = await parseJsonBody(req);
  const result = await userService.createRole(body, toServiceContext(actor));
  return respond(result, 201);
});
