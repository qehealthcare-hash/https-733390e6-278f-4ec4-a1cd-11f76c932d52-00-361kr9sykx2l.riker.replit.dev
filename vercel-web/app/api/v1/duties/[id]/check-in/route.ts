import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { dutyService } from "@/services/dutyService";
import { respondLegacy } from "@/lib/api/apiResultBridge";
import { parseInput } from "@/validation/parseValidation";
import { dutyCheckAtSchema } from "@/validation/dutyValidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const POST = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager", "Staff", "Nurse"]);
  const body = await parseJsonBody(req);
  const parsed = parseInput(dutyCheckAtSchema, body);
  if (!parsed.success) return respondLegacy(parsed);
  const result = await dutyService.checkIn(params.id, parsed.data?.at, { actor });
  return respondLegacy(result);
});
