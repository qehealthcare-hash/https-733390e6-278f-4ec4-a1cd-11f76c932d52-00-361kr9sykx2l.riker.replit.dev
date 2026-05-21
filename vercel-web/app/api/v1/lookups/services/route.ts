import { withAuth } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { lookupService } from "@/lib/api/services/lookup.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  const data = await lookupService.services();
  return jsonOk(data);
});
