import { withAuth } from "@/lib/api/handler";
import { toServiceContext } from "@/lib/api/serviceContext";
import { respond } from "@/lib/api/apiResultBridge";
import { lookupService } from "@/services/lookupService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (_req, { actor }) => {
  const result = await lookupService.services(toServiceContext(actor));
  return respond(result);
});
