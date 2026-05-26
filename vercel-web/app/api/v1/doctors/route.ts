import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { toServiceContext } from "@/lib/api/serviceContext";
import { respond } from "@/lib/api/apiResultBridge";
import { doctorService } from "@/services/doctorService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: NextRequest, { actor }) => {
  const url = new URL(req.url);
  const result = await doctorService.list(
    {
      q: url.searchParams.get("q") || undefined,
      city: url.searchParams.get("city") || undefined,
      spec: url.searchParams.get("spec") || undefined,
      limit: Number(url.searchParams.get("limit") || 100),
      offset: Number(url.searchParams.get("offset") || 0)
    },
    toServiceContext(actor)
  );
  return respond(result);
});

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Manager", "Accountant"]);
  const body = await parseJsonBody(req);
  const result = await doctorService.create(body, toServiceContext(actor));
  return respond(result, 201);
});
