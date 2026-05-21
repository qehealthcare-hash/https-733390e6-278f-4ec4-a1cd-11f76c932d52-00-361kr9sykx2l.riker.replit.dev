import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody, pageParams } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { requireRole } from "@/lib/api/auth";
import { dutyService, dutySchema } from "@/lib/api/services/duty.service";
import { withIdempotency } from "@/lib/api/idempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: NextRequest) => {
  const url = new URL(req.url);
  const result = await dutyService.list({
    ...pageParams(req),
    employeeId: url.searchParams.get("employee_id") || undefined,
    patientId: url.searchParams.get("patient_id") || undefined,
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined
  });
  return jsonOk(result);
});

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Manager", "Staff"]);
  return withIdempotency(req, actor, { route: "POST /duties" }, async () => {
    const body = await parseJsonBody(req);
    const input = dutySchema.parse(body);
    const row = await dutyService.create(input, actor);
    return jsonOk(row, 201);
  });
});
