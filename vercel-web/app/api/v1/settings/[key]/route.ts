import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import {
  SETTINGS_DELETE_ROLES,
  SETTINGS_READ_ROLES,
  SETTINGS_WRITE_ROLES
} from "@/lib/api/crmRoles";
import { toServiceContext } from "@/lib/api/serviceContext";
import { respond, respondValidated } from "@/lib/api/apiResultBridge";
import {
  settingsDeleteResultDtoSchema,
  settingsKeyValueDtoSchema,
  settingsRowDtoSchema
} from "@/validation/settingsDto";
import { settingsService } from "@/services/settingsService";
import { success } from "@/utils/apiResponse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { key: string };

export const GET = withAuth<Params>(async (_req: NextRequest, { params, actor }) => {
  requireRole(actor, [...SETTINGS_READ_ROLES]);
  const result = await settingsService.getKey(params.key, toServiceContext(actor));
  if (!result.success) return respond(result);
  return respondValidated(success({ key: params.key, value: result.data }), settingsKeyValueDtoSchema);
});

export const PUT = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, [...SETTINGS_WRITE_ROLES]);
  const body = await parseJsonBody(req);
  const value =
    body && Object.prototype.hasOwnProperty.call(body, "value")
      ? (body as { value: unknown }).value
      : body;
  const result = await settingsService.setKey(params.key, value, toServiceContext(actor));
  return respondValidated(result, settingsRowDtoSchema);
});

export const DELETE = withAuth<Params>(async (_req: NextRequest, { params, actor }) => {
  requireRole(actor, [...SETTINGS_DELETE_ROLES]);
  const result = await settingsService.deleteKey(params.key, toServiceContext(actor));
  return respondValidated(result, settingsDeleteResultDtoSchema);
});
