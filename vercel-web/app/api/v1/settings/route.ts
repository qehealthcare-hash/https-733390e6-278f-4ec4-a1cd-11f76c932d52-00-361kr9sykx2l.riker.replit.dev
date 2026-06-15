import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { SETTINGS_READ_ROLES, SETTINGS_WRITE_ROLES } from "@/lib/api/crmRoles";
import { toServiceContext } from "@/lib/api/serviceContext";
import { respondValidated } from "@/lib/api/apiResultBridge";
import {
  settingsBulkResultDtoSchema,
  settingsMapDtoSchema
} from "@/validation/settingsDto";
import { settingsService } from "@/services/settingsService";

/**
 * M11-G: App settings registry — no legacy sync route; values are
 * key/value rows in `hh_app_settings` only.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (_req, { actor }) => {
  requireRole(actor, [...SETTINGS_READ_ROLES]);
  const result = await settingsService.listAll(toServiceContext(actor));
  return respondValidated(result, settingsMapDtoSchema);
});

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, [...SETTINGS_WRITE_ROLES]);
  const body = await parseJsonBody(req);
  const result = await settingsService.bulkSet(body, toServiceContext(actor));
  return respondValidated(result, settingsBulkResultDtoSchema);
});
