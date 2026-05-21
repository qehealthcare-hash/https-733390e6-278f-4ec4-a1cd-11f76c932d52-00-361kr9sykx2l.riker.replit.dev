import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { badRequest, jsonOk } from "@/lib/api/errors";
import { requireRole } from "@/lib/api/auth";
import { billingService, billingSchema } from "@/lib/api/services/billing.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: NextRequest) => {
  const patientId = new URL(req.url).searchParams.get("patient_id");
  if (!patientId) throw badRequest("patient_id is required");
  const result = await billingService.listByPatient(patientId);
  return jsonOk(result);
});

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Manager", "Accountant"]);
  const body = await parseJsonBody(req);
  const input = billingSchema.parse(body);
  const row = await billingService.create(input, actor);
  return jsonOk(row, { status: 201 });
});
