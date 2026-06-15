import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { PATIENT_READ_ROLES, PATIENT_WRITE_ROLES } from "@/business/rbac";
import { withIdempotency } from "@/lib/api/idempotency";
import { patientService } from "@/services/patientService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { patientDetailDtoSchema, patientListResponseDtoSchema } from "@/validation/patientDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, PATIENT_READ_ROLES);
  const url = new URL(req.url);
  const query = {
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    gender: url.searchParams.get("gender") ?? undefined,
    area: url.searchParams.get("area") ?? undefined,
    pin: url.searchParams.get("pin") ?? undefined,
    shift: url.searchParams.get("shift") ?? undefined,
    caretaker_id: url.searchParams.get("caretaker_id") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined
  };
  const result = await patientService.list(query, { actor });
  return respondValidated(result, patientListResponseDtoSchema);
});

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, PATIENT_WRITE_ROLES);
  return withIdempotency(req, actor, { route: "POST /patients" }, async () => {
    const body = await parseJsonBody(req);
    const result = await patientService.create(body, { actor });
    return respondValidated(result, patientDetailDtoSchema, 201);
  });
});
