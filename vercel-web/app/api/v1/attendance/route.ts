import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { withIdempotency } from "@/lib/api/idempotency";
import { attendanceService } from "@/services/attendanceService";
import { respondLegacy } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: NextRequest, { actor }) => {
  const url = new URL(req.url);
  const query = {
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    employee_id: url.searchParams.get("employee_id") ?? undefined,
    duty_id: url.searchParams.get("duty_id") ?? undefined,
    patient_id: url.searchParams.get("patient_id") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined
  };
  const result = await attendanceService.list(query, { actor });
  return respondLegacy(result);
});

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Manager", "Staff", "Nurse", "Supervisor"]);
  return withIdempotency(req, actor, { route: "POST /attendance" }, async () => {
    const body = await parseJsonBody(req);
    const result = await attendanceService.create(body, { actor });
    return respondLegacy(result, 201);
  });
});
