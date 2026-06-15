import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { REPORT_READ_ROLES } from "@/lib/api/crmRoles";
import { reportService } from "@/services/reportService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { dutyReconciliationResponseDtoSchema } from "@/validation/reportDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, [...REPORT_READ_ROLES]);

  const url = new URL(req.url);
  const result = await reportService.reconciliation(
    {
      period: url.searchParams.get("period") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined
    },
    { actor }
  );
  return respondValidated(result, dutyReconciliationResponseDtoSchema);
});
