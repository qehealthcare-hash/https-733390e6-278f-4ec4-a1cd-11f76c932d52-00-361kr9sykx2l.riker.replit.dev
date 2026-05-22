import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { patientService } from "@/services/patientService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = withAuth<Params>(async (_req, { params, actor }) => {
  const result = await patientService.getById(params.id, { actor });
  return respond(result);
});

export const PATCH = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager", "Staff", "Executive"]);
  const body = await parseJsonBody(req);
  const result = await patientService.update(params.id, body, { actor });
  return respond(result);
});

export const PUT = PATCH;

export const DELETE = withAuth<Params>(async (_req, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager"]);
  const result = await patientService.remove(params.id, { actor });
  return respond(result);
});
