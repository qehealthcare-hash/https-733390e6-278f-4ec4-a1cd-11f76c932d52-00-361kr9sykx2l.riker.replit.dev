import { NextResponse, type NextRequest } from "next/server";
import { idempotencyRepository } from "@/database/idempotencyRepository";
import type { ActorContext } from "./auth";

/**
 * Idempotency-key middleware.
 *
 * Clients pass `Idempotency-Key: <uuid>` on POST requests they want to dedupe.
 * The first call runs the handler and persists the JSON response in
 * `public.hh_idempotency` keyed by (key, actor). Subsequent calls with the
 * same key + actor return the cached response without re-running the handler.
 *
 * - Keys older than 24h are ignored (let the route run again).
 * - When SUPABASE is unavailable, the wrapper just runs the handler.
 */
export interface IdempotencyConfig {
  route: string;
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export async function withIdempotency(
  req: NextRequest,
  actor: ActorContext,
  config: IdempotencyConfig,
  run: () => Promise<NextResponse>
): Promise<NextResponse> {
  const key = (req.headers.get("idempotency-key") || req.headers.get("Idempotency-Key") || "").trim();
  if (!key) return run();
  const ttl = config.ttlMs ?? DEFAULT_TTL_MS;
  const cutoff = new Date(Date.now() - ttl).toISOString();

  const cached = await idempotencyRepository.findCached(key, actor.email, cutoff);
  if (!cached.success) {
    console.error("[idempotency] cache read failed", cached.error);
    return run();
  }
  if (cached.data) {
    return NextResponse.json(cached.data.response ?? { ok: true, data: null }, {
      status: cached.data.status || 200,
      headers: { "Idempotent-Replay": "true" }
    });
  }

  const response = await run();
  try {
    const text = await response.clone().text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const persist = await idempotencyRepository.upsert({
      key,
      actor: actor.email,
      route: config.route,
      response: json as Record<string, unknown> | null,
      status: response.status
    });
    if (!persist.success) {
      console.error("[idempotency] persist failed", persist.error);
    }
  } catch (err) {
    console.error("[idempotency] persist failed", err);
  }
  return response;
}
