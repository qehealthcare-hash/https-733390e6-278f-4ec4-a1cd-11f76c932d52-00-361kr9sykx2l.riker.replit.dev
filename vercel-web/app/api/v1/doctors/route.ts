import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { jsonOk } from "@/lib/api/errors";
import { doctorService } from "@/lib/api/services/doctor.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: NextRequest, { actor }) => {
  const url = new URL(req.url);
  const data = await doctorService.list(
    {
      q: url.searchParams.get("q") || undefined,
      city: url.searchParams.get("city") || undefined,
      spec: url.searchParams.get("spec") || undefined,
      limit: Number(url.searchParams.get("limit") || 100),
      offset: Number(url.searchParams.get("offset") || 0)
    },
    actor.accessToken
  );
  return jsonOk(data);
});

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Manager", "Accountant"]);
  const body = await parseJsonBody(req);
  const data = await doctorService.create(body, actor.accessToken);
  return jsonOk(data, 201);
});
