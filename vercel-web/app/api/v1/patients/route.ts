import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody, pageParams } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { requireRole } from "@/lib/api/auth";
import { patientService, patientSchema } from "@/lib/api/services/patient.service";
import { withIdempotency } from "@/lib/api/idempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: NextRequest) => {
  const status = new URL(req.url).searchParams.get("status") || undefined;
  const result = await patientService.list({ ...pageParams(req), status });
  return jsonOk(result);
});

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Manager", "Staff"]);
  return withIdempotency(req, actor, { route: "POST /patients" }, async () => {
    const body = await parseJsonBody(req);
    const input = patientSchema.parse(body);
    const row = await patientService.create(input, actor);
    return jsonOk(row, 201);
  });
});
