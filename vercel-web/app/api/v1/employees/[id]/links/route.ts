import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { EMPLOYEE_LINKS_ROLES } from "@/business/rbac";
import { employeeService } from "@/services/employeeService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { employeeLinkCountsDtoSchema } from "@/validation/employeeDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

/** Counts of historical records (duties/attendance/payouts/patients). */
export const GET = withAuth<Params>(async (_req, { params, actor }) => {
  requireRole(actor, EMPLOYEE_LINKS_ROLES);
  const result = await employeeService.linkCounts(params.id, { actor });
  return respondValidated(result, employeeLinkCountsDtoSchema);
});
