import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import {
  INQUIRY_DELETE_ROLES,
  INQUIRY_READ_ROLES,
  INQUIRY_WRITE_ROLES
} from "@/business/rbac";
import { inquiryService } from "@/services/inquiryService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import {
  inquiryDetailDtoSchema,
  inquiryRemoveResultDtoSchema
} from "@/validation/inquiryDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = withAuth<Params>(async (_req: NextRequest, { params, actor }) => {
  requireRole(actor, INQUIRY_READ_ROLES);
  const result = await inquiryService.getById(params.id, { actor });
  return respondValidated(result, inquiryDetailDtoSchema);
});

export const PATCH = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, INQUIRY_WRITE_ROLES);
  const body = await parseJsonBody(req);
  const result = await inquiryService.update(params.id, body, { actor });
  return respondValidated(result, inquiryDetailDtoSchema);
});

export const PUT = PATCH;

export const DELETE = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, INQUIRY_DELETE_ROLES);

  const hard = new URL(req.url).searchParams.get("hard");
  if (hard === "1" || hard === "true") {
    requireRole(actor, ["Admin"]);
  }

  let body: unknown = undefined;
  try {
    const raw = await req.text();
    if (raw && raw.trim().length > 0) {
      body = JSON.parse(raw);
    }
  } catch {
    body = undefined;
  }
  const reason =
    body && typeof body === "object" && body !== null && "reason" in body
      ? String((body as { reason?: string }).reason || "")
      : "";

  const result = await inquiryService.remove(params.id, { actor }, {
    reason,
    hard: hard === "1" || hard === "true"
  });
  return respondValidated(result, inquiryRemoveResultDtoSchema);
});
