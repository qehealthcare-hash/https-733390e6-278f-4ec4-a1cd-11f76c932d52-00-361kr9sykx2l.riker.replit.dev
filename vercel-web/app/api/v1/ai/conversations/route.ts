import { withAuth } from "@/lib/api/handler";
import { toServiceContext } from "@/lib/api/serviceContext";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { aiConversationListDtoSchema } from "@/validation/aiDto";
import { aiService } from "@/services/aiService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (_req, { actor }) => {
  const result = await aiService.listConversations(toServiceContext(actor));
  return respondValidated(result, aiConversationListDtoSchema);
});
