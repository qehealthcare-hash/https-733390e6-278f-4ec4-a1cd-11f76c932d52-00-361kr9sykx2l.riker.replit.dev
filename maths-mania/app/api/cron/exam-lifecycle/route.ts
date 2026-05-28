import { verifyCronRequest } from "@/lib/cron/auth";
import { runExamLifecycleCron } from "@/lib/cron/exam-lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/exam-lifecycle
 *
 * Vercel Cron (see vercel.json): every 5 minutes.
 * - scheduled → live when starts_at passes
 * - live → closed when ends_at passes
 * - auto-publish merit MERIT_PUBLISH_DELAY_MIN after ends_at
 */
export async function GET(request: Request) {
  const auth = verifyCronRequest(request);
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error }, { status: 401 });
  }

  try {
    const result = await runExamLifecycleCron();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron] exam-lifecycle", err);
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Cron failed",
      },
      { status: 500 },
    );
  }
}
