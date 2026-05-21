import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { requireRole } from "@/lib/api/auth";
import { dutyService } from "@/lib/api/services/duty.service";
import { dutyCheckAtSchema } from "@/validation/dutyValidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const POST = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager", "Staff", "Nurse"]);
  const body = await parseJsonBody(req);
  const input = dutyCheckAtSchema.parse(body);
  const row = await dutyService.checkIn(params.id, input.at, actor);
  return jsonOk(row);
});
