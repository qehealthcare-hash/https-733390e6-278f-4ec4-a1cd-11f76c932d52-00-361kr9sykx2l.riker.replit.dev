import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { DUTY_CHECK_IN_ROLES } from "@/business/rbac";
import { dutyService } from "@/services/dutyService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { dutyDetailDtoSchema } from "@/validation/dutyDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const POST = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, DUTY_CHECK_IN_ROLES);
  const body = await parseJsonBody(req);
  const result = await dutyService.checkOut(params.id, body, { actor });
  return respondValidated(result, dutyDetailDtoSchema);
});
