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
export const DELETE = withAuth<Params>(async (req, { params, actor }) => {
  requireRole(actor, ["Admin"]);

  let body: unknown = undefined;
  try {
    const raw = await req.text();
    if (raw && raw.trim().length > 0) {
      body = JSON.parse(raw);
    }
  } catch {
    body = undefined;
  }
  const reason =
    body && typeof body === "object" && body !== null && "reason" in body
      ? String((body as { reason?: string }).reason || "")
      : "";

  const result = await employeeService.remove(params.id, { actor }, { reason });
  return respond(result);
});
