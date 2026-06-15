import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { INQUIRY_WRITE_ROLES } from "@/business/rbac";
import { withIdempotency } from "@/lib/api/idempotency";
import { inquiryService } from "@/services/inquiryService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { inquiryConvertResultDtoSchema } from "@/validation/inquiryDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * POST /api/v1/inquiries/:id/convert
 *
 * Converts the inquiry to a patient via the `hh_convert_inquiry_to_patient`
 * RPC. Idempotent — re-running returns the same `{ patient_id, inquiry_id }`.
 */
export const POST = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, INQUIRY_WRITE_ROLES);
  return withIdempotency(
    req,
    actor,
    { route: `POST /inquiries/${params.id}/convert` },
    async () => {
    // P1-33: surface parse errors instead of treating them as an empty body.
    const body = await parseJsonBody(req);
    const result = await inquiryService.convertToPatient(params.id, body, { actor });
      return respondValidated(result, inquiryConvertResultDtoSchema, 201);
    }
  );
});
