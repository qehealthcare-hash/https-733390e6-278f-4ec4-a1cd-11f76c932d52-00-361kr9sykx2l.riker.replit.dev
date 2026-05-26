import { respond } from "@/lib/api/apiResultBridge";
import { healthService } from "@/services/healthService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await healthService.snapshot();
  return respond(result);
}
