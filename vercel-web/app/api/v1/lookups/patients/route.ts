import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { lookupService } from "@/lib/api/services/lookup.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: NextRequest) => {
  const q = new URL(req.url).searchParams.get("q") || undefined;
  const data = await lookupService.patients(q);
  return jsonOk(data);
});
