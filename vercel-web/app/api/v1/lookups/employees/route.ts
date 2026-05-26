import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { toServiceContext } from "@/lib/api/serviceContext";
import { respond } from "@/lib/api/apiResultBridge";
import { lookupService } from "@/services/lookupService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: NextRequest, { actor }) => {
  const q = new URL(req.url).searchParams.get("q") || undefined;
  const result = await lookupService.employees(q, toServiceContext(actor));
  return respond(result);
});
