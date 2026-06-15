import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import {
  PATIENT_CLOSE_ROLES,
  PATIENT_READ_ROLES,
  PATIENT_WRITE_ROLES
} from "@/business/rbac";
import { patientService } from "@/services/patientService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import {
  patientDetailDtoSchema,
  patientHardDeleteResultDtoSchema
} from "@/validation/patientDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = withAuth<Params>(async (_req, { params, actor }) => {
  requireRole(actor, PATIENT_READ_ROLES);
  const result = await patientService.getById(params.id, { actor });
  return respondValidated(result, patientDetailDtoSchema);
});

export const PATCH = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, PATIENT_WRITE_ROLES);
  const body = await parseJsonBody(req);
  const result = await patientService.update(params.id, body, { actor });
  return respondValidated(result, patientDetailDtoSchema);
});

export const PUT = PATCH;

export const DELETE = withAuth<Params>(async (req, { params, actor }) => {
  requireRole(actor, PATIENT_CLOSE_ROLES);
  const hard = new URL(req.url).searchParams.get("hard");
  if (hard === "1" || hard === "true") {
    requireRole(actor, ["Admin"]);
    const result = await patientService.removePermanent(params.id, { actor });
    return respondValidated(result, patientHardDeleteResultDtoSchema);
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

  const result = await patientService.remove(params.id, { actor }, body);
  return respondValidated(result, patientDetailDtoSchema);
});
