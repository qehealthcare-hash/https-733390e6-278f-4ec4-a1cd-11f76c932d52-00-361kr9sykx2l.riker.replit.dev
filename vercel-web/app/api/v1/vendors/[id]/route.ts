import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { DIRECTORY_READ_ROLES } from "@/lib/api/crmRoles";
import { toServiceContext } from "@/lib/api/serviceContext";
import { respondValidated } from "@/lib/api/apiResultBridge";
import {
  vendorDeleteResultDtoSchema,
  vendorRowDtoSchema
} from "@/validation/vendorDto";
import { vendorService } from "@/services/vendorService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = withAuth<Params>(async (_req: NextRequest, { params, actor }) => {
  requireRole(actor, [...DIRECTORY_READ_ROLES]);
  const result = await vendorService.get(params.id, toServiceContext(actor));
  return respondValidated(result, vendorRowDtoSchema);
});

export const PATCH = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager", "Accountant"]);
  const body = await parseJsonBody(req);
  const result = await vendorService.update(params.id, body, toServiceContext(actor));
  return respondValidated(result, vendorRowDtoSchema);
});

export const PUT = PATCH;

export const DELETE = withAuth<Params>(async (_req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin"]);
  const result = await vendorService.remove(params.id, toServiceContext(actor));
  return respondValidated(result, vendorDeleteResultDtoSchema);
});
