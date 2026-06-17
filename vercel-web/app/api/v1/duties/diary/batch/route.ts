import type { NextRequest } from "next/server";
import { withAuth, parseJsonBody } from "@/lib/api/handler";
import { requireRole } from "@/lib/api/auth";
import { DUTY_DIARY_BATCH_ROLES } from "@/business/rbac";
import { dutyDiaryService } from "@/services/dutyDiaryService";
import { respond, respondValidated } from "@/lib/api/apiResultBridge";
import { parseInput } from "@/validation/parseValidation";
import { dutyDiaryBatchSchema } from "@/validation/dutyValidation";
import { diaryBatchResponseDtoSchema, diaryListEntryDtoSchema, diaryListResultDtoSchema } from "@/validation/dutyDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/v1/duties/diary/batch
 * body: { duty_ids: string[] }
 *
 * Batched diary read for the calendar UI. The page used to fan out one
 * `/duties/:id/diary` call per visible duty (N+1 against the database);
 * this endpoint folds those into a single round-trip.
 */
export const POST = withAuth(async (req: NextRequest, { actor }) => {
  requireRole(actor, DUTY_DIARY_BATCH_ROLES);
  const raw = await parseJsonBody(req);
  const parsed = parseInput(dutyDiaryBatchSchema, raw);
  if (!parsed.success || !parsed.data) return respond(parsed);
  const ids = parsed.data.duty_ids ?? [];
  const result = await dutyDiaryService.listDaysBatch(ids, { actor });
  return respondValidated(result, diaryBatchResponseDtoSchema, 200, {
    kind: "diary_batch",
    diaryBatch: {
      scope: "POST /duties/diary/batch",
      dutyResultSchema: diaryListResultDtoSchema,
      entrySchema: diaryListEntryDtoSchema
    }
  });
});
