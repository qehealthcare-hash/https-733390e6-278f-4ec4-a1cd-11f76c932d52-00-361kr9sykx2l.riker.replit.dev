import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { employeeService } from "@/services/employeeService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = withAuth<Params>(async (_req, { params, actor }) => {
  const result = await employeeService.getById(params.id, { actor });
  return respond(result);
});

export const PATCH = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager"]);
  const body = await parseJsonBody(req);
  const result = await employeeService.update(params.id, body, { actor });
  return respond(result);
});

export const PUT = PATCH;

/**
 * DELETE = soft-delete (status -> Inactive) when historical data exists.
 *
 * Allows hard-delete only if there are zero linked duties/attendance/payouts
 * /caretaker assignments. Either way, returns the resulting row (or the
 * pre-deletion snapshot) so the client can refetch and reconcile UI.
 */
export const DELETE = withAuth<Params>(async (_req, { params, actor }) => {
  requireRole(actor, ["Admin"]);
  const result = await employeeService.remove(params.id, { actor });
  return respond(result);
});
