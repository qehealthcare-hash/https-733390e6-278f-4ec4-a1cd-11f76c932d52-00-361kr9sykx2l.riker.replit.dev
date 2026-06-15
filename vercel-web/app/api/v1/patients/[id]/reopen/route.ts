import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { PATIENT_REOPEN_ROLES } from "@/business/rbac";
import { patientService } from "@/services/patientService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { patientDetailDtoSchema } from "@/validation/patientDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * POST /api/v1/patients/[id]/reopen — flip a soft-closed patient back to
 * Active. Admin / Manager only; refuses to create an Active duplicate on
 * the same phone number.
 */
export const POST = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, PATIENT_REOPEN_ROLES);
  let body: unknown = undefined;
  try {
    const raw = await req.text();
    if (raw && raw.trim().length > 0) body = JSON.parse(raw);
  } catch {
    body = undefined;
  }
  const result = await patientService.reopen(params.id, { actor }, body);
  return respondValidated(result, patientDetailDtoSchema);
});
