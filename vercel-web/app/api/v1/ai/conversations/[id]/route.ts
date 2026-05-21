import { withAuth } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { aiService } from "@/lib/api/services/ai.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = withAuth<Params>(async (_req, { params }) => {
  const data = await aiService.getConversation(params.id);
  return jsonOk(data);
});
