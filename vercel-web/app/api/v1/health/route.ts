import { respondValidated } from "@/lib/api/apiResultBridge";
import { healthSnapshotDtoSchema } from "@/validation/healthDto";
import { healthService } from "@/services/healthService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await healthService.snapshot();
  return respondValidated(result, healthSnapshotDtoSchema);
}
