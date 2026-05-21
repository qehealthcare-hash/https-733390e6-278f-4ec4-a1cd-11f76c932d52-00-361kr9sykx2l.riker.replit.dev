import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { employeeService } from "@/services/employeeService";
import { respondLegacy } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

/** Counts of historical records (duties/attendance/payouts/patients). */
export const GET = withAuth<Params>(async (_req, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager", "Accountant"]);
  const result = await employeeService.linkCounts(params.id, { actor });
  return respondLegacy(result);
});
