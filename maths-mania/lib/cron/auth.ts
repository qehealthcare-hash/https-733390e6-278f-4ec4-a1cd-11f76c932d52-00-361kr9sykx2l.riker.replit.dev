import { timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/**
 * Validates Vercel Cron (`Authorization: Bearer <CRON_SECRET>`) or manual
 * `x-cron-secret` header for staging smoke tests.
 */
export function verifyCronRequest(request: Request): {
  ok: boolean;
  error?: string;
} {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  const isProd =
    process.env.VERCEL_ENV === "production" ||
    process.env.NODE_ENV === "production";

  if (!secret) {
    if (isProd) {
      return {
        ok: false,
        error: "CRON_SECRET is not configured in production.",
      };
    }
    return { ok: true };
  }

  const auth = request.headers.get("authorization") ?? "";
  const legacy = request.headers.get("x-cron-secret") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

  const ok =
    (bearer.length > 0 && safeEqual(bearer, secret)) ||
    (legacy.length > 0 && safeEqual(legacy, secret));

  if (!ok) {
    return { ok: false, error: "Invalid or missing cron secret." };
  }

  return { ok: true };
}
