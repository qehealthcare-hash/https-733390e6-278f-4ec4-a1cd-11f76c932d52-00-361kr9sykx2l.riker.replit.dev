import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { DUTY_MATERIALIZE_ROLES } from "@/business/rbac";
import { dutyService } from "@/services/dutyService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

/** Expand duty date range into per-day patient charges + partner payouts. */
export const POST = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, DUTY_MATERIALIZE_ROLES);
  const body = await parseJsonBody(req);
  const result = await dutyService.materialize(params.id, body, { actor });
  return respond(result);
});
