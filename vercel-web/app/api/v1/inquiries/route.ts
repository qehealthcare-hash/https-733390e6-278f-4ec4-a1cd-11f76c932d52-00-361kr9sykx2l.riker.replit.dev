import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody, pageParams } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { requireRole } from "@/lib/api/auth";
import { inquiryService, inquirySchema } from "@/lib/api/services/inquiry.service";
import { withIdempotency } from "@/lib/api/idempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: NextRequest) => {
  const result = await inquiryService.list(pageParams(req));
  return jsonOk(result);
});

export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, ["Admin", "Manager", "Staff"]);
  return withIdempotency(req, actor, { route: "POST /inquiries" }, async () => {
    const body = await parseJsonBody(req);
    const input = inquirySchema.parse(body);
    const row = await inquiryService.create(input, actor);
    return jsonOk(row, 201);
  });
});
