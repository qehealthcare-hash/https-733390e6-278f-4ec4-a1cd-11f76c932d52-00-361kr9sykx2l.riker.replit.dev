import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { withIdempotency } from "@/lib/api/idempotency";
import { toServiceContext } from "@/lib/api/serviceContext";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { whatsappSendResultDtoSchema } from "@/validation/whatsappDto";
import { whatsappService } from "@/services/whatsappService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Manager"]);
  return withIdempotency(req, actor, { route: "POST /whatsapp/send" }, async () => {
    const body = await parseJsonBody(req);
    const result = await whatsappService.sendText(body, toServiceContext(actor));
    return respondValidated(result, whatsappSendResultDtoSchema);
  });
});
