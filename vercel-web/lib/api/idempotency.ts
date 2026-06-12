import { NextResponse, type NextRequest } from "next/server";
import { idempotencyRepository } from "@/database/idempotencyRepository";
import type { ActorContext } from "./auth";

/**
 * Idempotency-key middleware.
 *
 * Two callers can land on a write route at essentially the same time:
 *
 *   - React strict-mode double-fires the same submit during dev.
 *   - The user double-clicks Save on a flaky network.
 *   - The browser retries after a 5xx that the server actually committed.
 *
 * Before this rewrite the wrapper short-circuited the moment no header was
 * present, AND it had a TOCTOU window:
 *   1. caller A reads cache → miss
 *   2. caller B reads cache → miss
 *   3. both A and B run() and write two rows / two payments / two patients
 *   4. only the LAST upsert wins on the cache row
 *
 * The new flow closes both gaps:
 *
 *   1. If the client did not send `Idempotency-Key`, we **synthesize** a
 *      stable key from `actor.email + route + canonical-body-hash` so
 *      strict-mode and double-click both share a key.
 *   2. We **reserve a pending row** via `INSERT ... ON CONFLICT DO NOTHING`
 *      BEFORE invoking the handler. The winning caller runs the handler and
 *      writes the final response; every other caller for the same key sees
 *      the conflict and either replays the cached response (if completed)
 *      or gets a 409 (`code: "idempotent_pending"`) telling them to retry.
 */
export interface IdempotencyConfig {
  route: string;
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
/** Stale PENDING rows older than this may be reclaimed (P0-9). */
export const PENDING_TTL_MS = 30_000;

// ─── canonical body + stable hash ─────────────────────────────────────────

function canonicalizeForHash(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalizeForHash);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) out[key] = canonicalizeForHash(obj[key]);
  return out;
}

/**
 * FNV-1a 32-bit hex, ported to match `lib/api-client.js#fnv1aHex` so the
 * server- and client-derived keys collide identically when the same
 * (method, path, body) is hashed on both sides.
 */
function fnv1aHex(input: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function bodyHash(text: string): string {
  // canonicalize JSON if it parses; otherwise hash the raw text
  let canonical = text;
  if (text) {
    try {
      canonical = JSON.stringify(canonicalizeForHash(JSON.parse(text)));
    } catch {
      // not JSON — fall through with raw text
    }
  }
  const splitAt = Math.max(1, Math.floor(canonical.length / 2));
  return fnv1aHex(canonical.slice(0, splitAt)) + fnv1aHex(canonical.slice(splitAt));
}

async function synthKeyFromRequest(
  req: NextRequest,
  actor: ActorContext,
  route: string
): Promise<string> {
  let bodyText = "";
  try {
    bodyText = await req.clone().text();
  } catch (err) {
    // `req.clone()` throws once the body has been consumed (e.g. the route
    // parsed `req.json()` before invoking withIdempotency). In that case
    // every call from the same actor+route collapses to the same synth key,
    // which silently breaks deduplication. Surface the regression loudly so
    // it does not get masked by the empty-body fallback.
    console.warn(
      `[idempotency] body unavailable for synth key on ${route} — caller must invoke withIdempotency BEFORE consuming req.body`,
      err
    );
    bodyText = "";
  }
  const payload = `${actor.email}|${route}|${bodyText ? bodyHash(bodyText) : ""}`;
  const splitAt = Math.max(1, Math.floor(payload.length / 2));
  return `synth-${fnv1aHex(payload.slice(0, splitAt))}${fnv1aHex(payload.slice(splitAt))}`;
}

// ─── middleware ───────────────────────────────────────────────────────────

export async function withIdempotency(
  req: NextRequest,
  actor: ActorContext,
  config: IdempotencyConfig,
  run: () => Promise<NextResponse>
): Promise<NextResponse> {
  let key = (
    req.headers.get("idempotency-key") ||
    req.headers.get("Idempotency-Key") ||
    ""
  ).trim();
  if (!key) {
    key = await synthKeyFromRequest(req, actor, config.route);
  }

  const ttl = config.ttlMs ?? DEFAULT_TTL_MS;
  const cutoff = new Date(Date.now() - ttl).toISOString();

  // 1) Reserve the key with INSERT ... ON CONFLICT DO NOTHING.
  //
  // The reservation lands a pending row (status = 0, response = null). The
  // operation is atomic at the Postgres level, so exactly one caller wins
  // the row and the rest see a clean conflict.
  const reserved = await idempotencyRepository.tryReservePending({
    key,
    actor: actor.email,
    route: config.route
  });

  if (!reserved.success) {
    // Reservation itself failed (Supabase outage etc.). Best-effort: fall
    // through to running the handler. The TOCTOU window opens here but we
    // would rather process the user's write than refuse it.
    console.error("[idempotency] reserve failed", reserved.error);
    return run();
  }

  if (!reserved.data) {
    // 2a) Race lost — another caller is processing or already finished.
    const cached = await idempotencyRepository.findCached(key, actor.email, cutoff);
    if (cached.success && cached.data?.response) {
      return NextResponse.json(cached.data.response, {
        status: cached.data.status || 200,
        headers: { "Idempotent-Replay": "true" }
      });
    }
    // Still pending. Tell the client to back off; the next retry will hit
    // either the cached response or a fresh reservation.
    return NextResponse.json(
      {
        success: false,
        error: "Idempotent request still in flight — retry shortly",
        code: "idempotent_pending"
      },
      { status: 409, headers: { "Retry-After": "2" } }
    );
  }

  // 2b) We hold the reservation. Run the handler and persist its response.
  const response = await run();
  try {
    const text = await response.clone().text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const persist = await idempotencyRepository.completePending({
      key,
      actor: actor.email,
      response: json as Record<string, unknown> | null,
      status: response.status
    });
    if (!persist.success) {
      console.error("[idempotency] complete failed", persist.error);
    }
  } catch (err) {
    console.error("[idempotency] complete failed", err);
  }
  return response;
}
