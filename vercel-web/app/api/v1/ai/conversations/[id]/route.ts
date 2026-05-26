import { withAuth } from "@/lib/api/handler";
import { respond } from "@/lib/api/apiResultBridge";
import { aiService } from "@/services/aiService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = withAuth<Params>(async (_req, { params }) => {
  const result = await aiService.getConversation(params.id);
  return respond(result);
});
