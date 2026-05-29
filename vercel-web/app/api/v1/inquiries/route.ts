import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { INQUIRY_READ_ROLES, INQUIRY_WRITE_ROLES } from "@/business/rbac";
import { withIdempotency } from "@/lib/api/idempotency";
import { inquiryService } from "@/services/inquiryService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, INQUIRY_READ_ROLES);
  const url = new URL(req.url);
  const query = {
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    open_only: url.searchParams.get("open_only") ?? undefined,
    source: url.searchParams.get("source") ?? undefined,
    assigned_to: url.searchParams.get("assigned_to") ?? undefined,
    followup_from: url.searchParams.get("followup_from") ?? undefined,
    followup_to: url.searchParams.get("followup_to") ?? undefined
  };
  const result = await inquiryService.list(query, { actor });
  return respond(result);
});

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, INQUIRY_WRITE_ROLES);
  return withIdempotency(req, actor, { route: "POST /inquiries" }, async () => {
    const body = await parseJsonBody(req);
    const result = await inquiryService.create(body, { actor });
    return respond(result, 201);
  });
});
