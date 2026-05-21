import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { requireRole } from "@/lib/api/auth";
import { patientService } from "@/lib/api/services/patient.service";
import { patientAssignSchema } from "@/validation/patientValidation";
import { withIdempotency } from "@/lib/api/idempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const POST = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager", "Staff"]);
  return withIdempotency(req, actor, { route: `POST /patients/${params.id}/assign` }, async () => {
    const body = await parseJsonBody(req);
    const input = patientAssignSchema.parse(body);
    const row = await patientService.assignCaretaker(params.id, input.caretaker_id, input.shift, actor);
    return jsonOk(row);
  });
});
