import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody, pageParams } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { withIdempotency } from "@/lib/api/idempotency";
import { employeeService } from "@/services/employeeService";
import { respondLegacy } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: NextRequest, { actor }) => {
  const url = new URL(req.url);
  const opts = {
    ...pageParams(req),
    status: url.searchParams.get("status") || undefined,
    dept: url.searchParams.get("dept") || undefined
  };
  const result = await employeeService.list(opts, { actor });
  return respondLegacy(result);
});

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Manager"]);
  return withIdempotency(req, actor, { route: "POST /employees" }, async () => {
    const body = await parseJsonBody(req);
    const result = await employeeService.create(body, { actor });
    return respondLegacy(result, 201);
  });
});
