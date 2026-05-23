import { withAuth } from "@/lib/api/handler";
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
export const POST = withAuth<Params>(async (_req, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager"]);
  const result = await patientService.reopen(params.id, { actor });
  return respond(result);
});
