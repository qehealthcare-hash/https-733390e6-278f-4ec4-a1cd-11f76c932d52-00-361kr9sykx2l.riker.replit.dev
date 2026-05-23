import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { lookupService } from "@/lib/api/services/lookup.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: NextRequest, { actor }) => {
  const q = new URL(req.url).searchParams.get("q") || undefined;
  const data = await lookupService.employees(q, actor.accessToken);
  return jsonOk(data);
});
