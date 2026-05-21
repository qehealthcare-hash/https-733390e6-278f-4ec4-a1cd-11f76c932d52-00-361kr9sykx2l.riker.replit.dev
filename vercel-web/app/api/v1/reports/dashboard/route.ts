import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/api/handler";
import { jsonOk } from "@/lib/api/errors";
import { reportService } from "@/lib/api/services/report.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: NextRequest) => {
  const url = new URL(req.url);
  const month = url.searchParams.get("month") || undefined;
  const data = await reportService.dashboard(month);
  return jsonOk(data);
});
