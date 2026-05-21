import { withAuth } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { requireRole } from "@/lib/api/auth";
import { inquiryService } from "@/lib/api/services/inquiry.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const POST = withAuth<Params>(async (_req, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager", "Staff"]);
  const result = await inquiryService.convertToPatient(params.id, actor);
  return jsonOk(result);
});
