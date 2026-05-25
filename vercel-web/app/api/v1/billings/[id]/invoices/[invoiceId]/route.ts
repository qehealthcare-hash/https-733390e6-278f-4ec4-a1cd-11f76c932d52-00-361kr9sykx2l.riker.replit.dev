import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { BILLING_READ_ROLES } from "@/lib/api/billingRoles";
import { billingService } from "@/services/billingService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string; invoiceId: string };

export const GET = withAuth<Params>(async (_req: NextRequest, { params, actor }) => {
  requireRole(actor, [...BILLING_READ_ROLES]);
  const result = await billingService.getInvoice(params.invoiceId, { actor });
  return respond(result);
});

export const DELETE = withAuth<Params>(async (_req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager", "Accountant"]);
  const result = await billingService.cancelInvoice(params.invoiceId, { actor });
  return respond(result);
});
