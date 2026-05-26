import type { NextRequest } from "next/server";
import { withAuth, pageParams } from "@/lib/api/handler";
import { respond } from "@/lib/api/apiResultBridge";
import { whatsappService } from "@/services/whatsappService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: NextRequest) => {
  const url = new URL(req.url);
  const { limit, offset } = pageParams(req);
  const result = await whatsappService.list({
    limit,
    offset,
    relatedModule: url.searchParams.get("module") || undefined,
    relatedId: url.searchParams.get("related_id") || undefined
  });
  return respond(result);
});
