import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/api/auth";
import { REGISTRY_READ_ROLES } from "@/lib/api/crmRoles";
import { withAuth } from "@/lib/api/handler";
import { toServiceContext } from "@/lib/api/serviceContext";
import { respond } from "@/lib/api/apiResultBridge";
import { lookupService } from "@/services/lookupService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, [...REGISTRY_READ_ROLES]);
  const q = new URL(req.url).searchParams.get("q") || undefined;
  const result = await lookupService.patients(q, toServiceContext(actor));
  return respond(result);
});
