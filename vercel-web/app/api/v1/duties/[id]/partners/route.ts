import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { DUTY_PARTNERS_ROLES } from "@/business/rbac";
import { dutyService } from "@/services/dutyService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { dutyAssignPartnersResponseDtoSchema } from "@/validation/dutyDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

/** Assign extra partners on a duty (multi-staff per patient). */
export const POST = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, DUTY_PARTNERS_ROLES);
  const body = await parseJsonBody(req);
  const result = await dutyService.assignPartners(params.id, body, { actor });
  return respondValidated(result, dutyAssignPartnersResponseDtoSchema);
});
