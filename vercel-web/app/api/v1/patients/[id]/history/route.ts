import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { PATIENT_HISTORY_ROLES } from "@/business/rbac";
import { patientService } from "@/services/patientService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { patientHistoryDtoSchema } from "@/validation/patientDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = withAuth<Params>(async (_req, { params, actor }) => {
  requireRole(actor, PATIENT_HISTORY_ROLES);
  const result = await patientService.history(params.id, { actor });
  return respondValidated(result, patientHistoryDtoSchema);
});
