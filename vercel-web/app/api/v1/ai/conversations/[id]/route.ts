import { withAuth } from "@/lib/api/handler";
import { toServiceContext } from "@/lib/api/serviceContext";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { aiConversationDetailDtoSchema } from "@/validation/aiDto";
import { aiService } from "@/services/aiService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = withAuth<Params>(async (_req, { params, actor }) => {
  const result = await aiService.getConversation(params.id, toServiceContext(actor));
  return respondValidated(result, aiConversationDetailDtoSchema);
});
