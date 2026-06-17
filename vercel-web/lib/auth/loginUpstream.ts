/**
 * Helpers for the server-side login proxy — classify Supabase Auth failures
 * so operators see "service unavailable" instead of "invalid password" when
 * the database is overloaded.
 */

const UPSTREAM_STATUS = new Set([502, 503, 504, 522, 524]);

export function isUpstreamHttpStatus(status: number): boolean {
  return UPSTREAM_STATUS.has(status);
}

export function isUpstreamAuthBody(body: Record<string, unknown> | null | undefined): boolean {
  if (!body || typeof body !== "object") return false;
  const code = String(body.error_code || body.code || "").toLowerCase();
  const msg = String(body.error_description || body.msg || body.message || body.error || "").toLowerCase();
  if (code === "request_timeout") return true;
  if (/timeout|timed out|deadline exceeded|temporarily unavailable|connection timed out/.test(msg)) {
    return true;
  }
  return false;
}

export function loginUpstreamMessage(): string {
  return (
    "Sign-in service is temporarily unavailable — the database took too long to respond. " +
    "Wait a minute and try again."
  );
}

export async function fetchWithLoginTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 25_000
): Promise<Response> {
  const signal =
    init.signal ??
    (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
      ? AbortSignal.timeout(timeoutMs)
      : undefined);
  try {
    return await fetch(url, { ...init, signal });
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : "";
    if (name === "AbortError" || name === "TimeoutError") {
      return new Response("", { status: 504, statusText: "Gateway Timeout" });
    }
    throw err;
  }
}
