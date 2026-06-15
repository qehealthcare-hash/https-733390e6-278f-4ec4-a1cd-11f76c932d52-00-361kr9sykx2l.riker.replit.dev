import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { BILLING_READ_ROLES } from "@/lib/api/billingRoles";
import { withIdempotency } from "@/lib/api/idempotency";
import { billingService } from "@/services/billingService";
import { respondValidated } from "@/lib/api/apiResultBridge";
import {
  generateInvoiceResultDtoSchema,
  invoiceSummaryListDtoSchema
} from "@/validation/billingDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = withAuth<Params>(async (_req: NextRequest, { params, actor }) => {
  requireRole(actor, [...BILLING_READ_ROLES]);
  const result = await billingService.listInvoices(params.id, { actor });
  return respondValidated(result, invoiceSummaryListDtoSchema);
});

/**
 * POST /api/v1/billings/[id]/invoices
 *   body: GenerateInvoiceInput (kind=MONTHLY|MANUAL, period, manual_lines, …)
 *
 * Each call allocates a fresh invoice number and starts UNPAID.
 * MONTHLY for the same period is idempotent (returns existing with duplicate:true).
 */
export const POST = withAuth<Params>(async (req: NextRequest, { params, actor }) => {
  requireRole(actor, ["Admin", "Manager", "Accountant"]);
  return withIdempotency(
    req,
    actor,
    { route: `POST /billings/${params.id}/invoices` },
    async () => {
      const body = await parseJsonBody(req);
      const result = await billingService.generateInvoice(
        { ...(body as object), billing_id: params.id },
        { actor }
      );
      return respondValidated(result, generateInvoiceResultDtoSchema, 201);
    }
  );
});
