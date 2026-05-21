import { withAuth } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { aiService } from "@/lib/api/services/ai.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (_req, { actor }) => {
  const data = await aiService.listConversations(actor);
  return jsonOk(data);
});
