import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody, pageParams } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { requireRole } from "@/lib/api/auth";
import { employeeService, employeeSchema } from "@/lib/api/services/employee.service";
import { withIdempotency } from "@/lib/api/idempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: NextRequest) => {
  const url = new URL(req.url);
  const opts = {
    ...pageParams(req),
    status: url.searchParams.get("status") || undefined
  };
  const result = await employeeService.list(opts);
  return jsonOk(result);
});

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Manager"]);
  return withIdempotency(req, actor, { route: "POST /employees" }, async () => {
    const body = await parseJsonBody(req);
    const input = employeeSchema.parse(body);
    const data = await employeeService.create(input, actor);
    return jsonOk(data, 201);
  });
});
