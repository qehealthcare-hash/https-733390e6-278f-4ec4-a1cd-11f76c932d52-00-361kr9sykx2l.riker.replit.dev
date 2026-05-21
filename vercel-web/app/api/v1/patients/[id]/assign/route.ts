import type { NextRequest } from "next/server";
import { z } from "zod";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { requireRole } from "@/lib/api/auth";
import { patientService } from "@/lib/api/services/patient.service";
import { idSchema } from "@/lib/api/validation";
import { withIdempotency } from "@/lib/api/idempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const assignSchema = z.object({
  caretaker_id: idSchema,
  shift: z.enum(["DAY", "NIGHT", "24H", "FULL"]).default("DAY")
});

type Params = { id: string };

export const POST = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager", "Staff"]);
  return withIdempotency(req, actor, { route: `POST /patients/${params.id}/assign` }, async () => {
    const body = await parseJsonBody(req);
    const input = assignSchema.parse(body);
    const row = await patientService.assignCaretaker(params.id, input.caretaker_id, input.shift, actor);
    return jsonOk(row);
  });
});
