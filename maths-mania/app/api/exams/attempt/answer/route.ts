import { saveAnswerHttp } from "@/lib/exams/attempt-http";
import {
  createBearerClient,
  getBearerToken,
} from "@/lib/supabase/bearer-client";

export const dynamic = "force-dynamic";

/**
 * HTTP autosave for k6 load tests (§14.7).
 * POST body: { attemptId, questionId, selectedIdx, markedForReview?, timeSpentSec? }
 */
export async function POST(request: Request) {
  const token = getBearerToken(request);
  if (!token) {
    return Response.json({ ok: false, error: "MISSING_TOKEN" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "INVALID_JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return Response.json({ ok: false, error: "INVALID_BODY" }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const attemptId = typeof raw.attemptId === "string" ? raw.attemptId : "";
  const questionId = typeof raw.questionId === "string" ? raw.questionId : "";
  const selectedIdx =
    raw.selectedIdx === null
      ? null
      : typeof raw.selectedIdx === "number"
        ? raw.selectedIdx
        : NaN;

  if (!attemptId || !questionId || selectedIdx === undefined || Number.isNaN(selectedIdx)) {
    return Response.json(
      { ok: false, error: "MISSING_FIELDS" },
      { status: 400 },
    );
  }

  const supabase = createBearerClient(token);
  if (!supabase) {
    return Response.json(
      { ok: false, error: "SUPABASE_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  const result = await saveAnswerHttp(supabase, {
    attemptId,
    questionId,
    selectedIdx,
    markedForReview:
      typeof raw.markedForReview === "boolean" ? raw.markedForReview : false,
    timeSpentSec:
      typeof raw.timeSpentSec === "number" ? raw.timeSpentSec : 0,
  });

  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  return Response.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
