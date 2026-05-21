import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody, pageParams } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { attendanceService, attendanceSchema } from "@/lib/api/services/attendance.service";
import { withIdempotency } from "@/lib/api/idempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: NextRequest) => {
  const url = new URL(req.url);
  const page = pageParams(req);
  const data = await attendanceService.list({
    limit: page.limit,
    offset: page.offset,
    employeeId: url.searchParams.get("employee_id") || undefined,
    dutyId: url.searchParams.get("duty_id") || undefined,
    status: url.searchParams.get("status") || undefined,
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined
  });
  return jsonOk(data);
});

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  return withIdempotency(req, actor, { route: "POST /attendance" }, async () => {
    const body = await parseJsonBody(req);
    const input = attendanceSchema.parse(body);
    const data = await attendanceService.create(input, actor);
    return jsonOk(data, 201);
  });
});
