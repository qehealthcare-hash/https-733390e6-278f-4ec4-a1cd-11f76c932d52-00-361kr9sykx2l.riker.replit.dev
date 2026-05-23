import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { patientService } from "@/services/patientService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * POST /api/v1/patients/[id]/reopen — flip a soft-closed patient back to
 * Active. Admin / Manager only; refuses to create an Active duplicate on
 * the same phone number.
 */
export const POST = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager"]);
  let body: unknown = undefined;
  try {
    const raw = await req.text();
    if (raw && raw.trim().length > 0) body = JSON.parse(raw);
  } catch {
    body = undefined;
  }
  const result = await patientService.reopen(params.id, { actor }, body);
  return respond(result);
});
