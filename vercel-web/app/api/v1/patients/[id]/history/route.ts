import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { REGISTRY_READ_ROLES } from "@/lib/api/crmRoles";
import { patientService } from "@/services/patientService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = withAuth<Params>(async (_req, { params, actor }) => {
  requireRole(actor, [...REGISTRY_READ_ROLES]);
  requireRole(actor, ["Admin", "Manager", "Staff", "Executive", "Nurse"]);
  const result = await patientService.history(params.id, { actor });
  return respond(result);
});
