import type { NextRequest } from "next/server";
import { withAuth, pageParams } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { whatsappService } from "@/lib/api/services/whatsapp.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: NextRequest) => {
  const url = new URL(req.url);
  const result = await whatsappService.list({
    ...pageParams(req),
    relatedModule: url.searchParams.get("module") || undefined,
    relatedId: url.searchParams.get("related_id") || undefined
  });
  return jsonOk(result);
});
