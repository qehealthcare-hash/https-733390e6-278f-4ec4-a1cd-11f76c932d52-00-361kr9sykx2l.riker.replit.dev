import { startAttemptHttp } from "@/lib/exams/attempt-http";
import {
  createBearerClient,
  getBearerToken,
} from "@/lib/supabase/bearer-client";

export const dynamic = "force-dynamic";

/**
 * HTTP entry for k6 load tests — mirrors start_exam_attempt RPC.
 * POST { "examId": "uuid" } with Authorization: Bearer <supabase_jwt>
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

  const examId =
    typeof body === "object" &&
    body !== null &&
    typeof (body as Record<string, unknown>).examId === "string"
      ? (body as Record<string, string>).examId
      : "";

  if (!examId) {
    return Response.json({ ok: false, error: "EXAM_ID_REQUIRED" }, { status: 400 });
  }

  const supabase = createBearerClient(token);
  if (!supabase) {
    return Response.json(
      { ok: false, error: "SUPABASE_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  const result = await startAttemptHttp(supabase, examId);
  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  return Response.json(
    {
      ok: true,
      attemptId: result.attemptId,
      startedAt: result.startedAt,
      examEndsAt: result.examEndsAt,
      serverNow: result.serverNow,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
