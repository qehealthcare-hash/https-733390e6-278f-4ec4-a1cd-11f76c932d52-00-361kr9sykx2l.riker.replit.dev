import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { PATIENT_WRITE_ROLES } from "@/business/rbac";
import { withIdempotency } from "@/lib/api/idempotency";
import { patientService } from "@/services/patientService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { patientDetailDtoSchema } from "@/validation/patientDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const POST = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, PATIENT_WRITE_ROLES);
  return withIdempotency(req, actor, { route: `POST /patients/${params.id}/assign` }, async () => {
    const body = await parseJsonBody(req);
    const result = await patientService.assignCaretaker(params.id, body, { actor });
    return respondValidated(result, patientDetailDtoSchema);
  });
});
