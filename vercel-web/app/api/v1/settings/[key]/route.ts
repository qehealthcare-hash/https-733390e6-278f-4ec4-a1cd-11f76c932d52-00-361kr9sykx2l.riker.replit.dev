import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { toServiceContext } from "@/lib/api/serviceContext";
import { respond } from "@/lib/api/apiResultBridge";
import { settingsService } from "@/services/settingsService";
import { success } from "@/utils/apiResponse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { key: string };

export const GET = withAuth<Params>(async (_req: NextRequest, { params, actor }) => {
  const result = await settingsService.getKey(params.key, toServiceContext(actor));
  if (!result.success) return respond(result);
  return respond(success({ key: params.key, value: result.data }));
});

export const PUT = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager"]);
  const body = await parseJsonBody(req);
  const value =
    body && Object.prototype.hasOwnProperty.call(body, "value")
      ? (body as { value: unknown }).value
      : body;
  const result = await settingsService.setKey(params.key, value, toServiceContext(actor));
  return respond(result);
});

export const DELETE = withAuth<Params>(async (_req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin"]);
  const result = await settingsService.deleteKey(params.key, toServiceContext(actor));
  return respond(result);
});
