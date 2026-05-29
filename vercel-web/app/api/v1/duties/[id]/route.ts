import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import {
  DUTY_CANCEL_ROLES,
  DUTY_DELETE_ROLES,
  DUTY_READ_ROLES,
  DUTY_WRITE_ROLES
} from "@/business/rbac";
import { dutyService } from "@/services/dutyService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = withAuth<Params>(async (_req, { params, actor }) => {
  requireRole(actor, DUTY_READ_ROLES);
  const result = await dutyService.getById(params.id, { actor });
  return respond(result);
});

export const PATCH = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, DUTY_WRITE_ROLES);
  const body = await parseJsonBody(req);
  const result = await dutyService.update(params.id, body, { actor });
  return respond(result);
});

export const PUT = PATCH;

/**
 * DELETE soft-cancels a duty (status = CANCELLED) and rolls back its billing
 * service entry when safe. Pass `?hard=1` (Admin-only) to permanently delete
 * the duty + diary rows. Returns the persisted row so the frontend can
 * refetch without race conditions.
 */
export const DELETE = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  const url = new URL(req.url);
  const hard = url.searchParams.get("hard") === "1";

  if (hard) {
    requireRole(actor, DUTY_DELETE_ROLES);
    const result = await dutyService.hardDelete(params.id, { actor });
    return respond(result);
  }

  requireRole(actor, DUTY_CANCEL_ROLES);
  let body: Record<string, unknown> = {};
  try {
    body = (await parseJsonBody(req)) ?? {};
  } catch {
    body = {};
  }
  const reason = (body.reason as string) || url.searchParams.get("reason") || "";
  const result = await dutyService.cancel(params.id, { reason }, { actor });
  return respond(result);
});
