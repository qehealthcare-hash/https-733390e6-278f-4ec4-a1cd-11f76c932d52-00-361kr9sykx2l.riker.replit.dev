import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { toServiceContext } from "@/lib/api/serviceContext";
import { respond } from "@/lib/api/apiResultBridge";
import { aiService } from "@/services/aiService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  // Finance scope is filtered server-side inside aiService.buildContext —
  // here we just gate the route to known CRM roles.
  requireRole(actor, ["Admin", "Manager", "Accountant", "Staff"]);
  const body = await parseJsonBody(req);
  const result = await aiService.ask(body, toServiceContext(actor));
  return respond(result);
});
