import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { patientService } from "@/services/patientService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = withAuth<Params>(async (_req, { params, actor }) => {
  const result = await patientService.getById(params.id, { actor });
  return respond(result);
});

export const PATCH = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager", "Staff", "Executive"]);
  const body = await parseJsonBody(req);
  const result = await patientService.update(params.id, body, { actor });
  return respond(result);
});

export const PUT = PATCH;

export const DELETE = withAuth<Params>(async (req, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager"]);
  // ?hard=1 → permanent delete (Admin-only, refuses if linked rows exist).
  // Otherwise we soft-close, which is idempotent on already-Closed rows
  // and accepts an optional `{ reason, reason_other }` JSON body so the
  // operator's close reason is persisted to the audit stamp.
  const hard = new URL(req.url).searchParams.get("hard");
  if (hard === "1" || hard === "true") {
    requireRole(actor, ["Admin"]);
    const result = await patientService.removePermanent(params.id, { actor });
    return respond(result);
  }

  let body: unknown = undefined;
  try {
    const raw = await req.text();
    if (raw && raw.trim().length > 0) {
      body = JSON.parse(raw);
    }
  } catch {
    // Non-JSON body → ignore; fallback to no-reason close (backwards compat).
    body = undefined;
  }

  const result = await patientService.remove(params.id, { actor }, body);
  return respond(result);
});
