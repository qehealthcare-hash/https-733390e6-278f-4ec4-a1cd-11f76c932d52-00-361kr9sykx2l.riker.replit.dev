import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { auditService } from "@/services/auditService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/audits — paginated audit trail (module / entity / action filters). */
export const GET = withAuth(async (req: NextRequest, { actor }) => {
  const url = new URL(req.url);
  const query = {
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
    module: url.searchParams.get("module") ?? undefined,
    entity_id: url.searchParams.get("entity_id") ?? undefined,
    action: url.searchParams.get("action") ?? undefined
  };
  const result = await auditService.list(query, { actor });
  return respond(result);
});
