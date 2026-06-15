import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { billingService } from "@/services/billingService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { billingRowDtoSchema } from "@/validation/billingDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const POST = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager", "Accountant"]);
  const body = await parseJsonBody(req);
  const result = await billingService.setStatus(params.id, body, { actor });
  return respondValidated(result, billingRowDtoSchema);
});
