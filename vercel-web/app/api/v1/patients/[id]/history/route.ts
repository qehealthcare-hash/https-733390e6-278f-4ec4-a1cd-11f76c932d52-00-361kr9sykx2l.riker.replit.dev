import { withAuth } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { patientService } from "@/lib/api/services/patient.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = withAuth<Params>(async (_req, { params }) => {
  const result = await patientService.history(params.id);
  return jsonOk(result);
});
