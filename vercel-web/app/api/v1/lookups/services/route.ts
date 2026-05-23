import { withAuth } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { lookupService } from "@/lib/api/services/lookup.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (_req, { actor }) => {
  const data = await lookupService.services(actor.accessToken);
  return jsonOk(data);
});
