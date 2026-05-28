import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { forbidden } from "./errors";

export function isProduction(): boolean {
  return process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
}

/** Constant-time string compare for secrets (cron, webhook verify tokens). */
export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  try {
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export const MAX_JSON_BODY_BYTES = 1024 * 1024;

// P1-10: rate-limit state must survive Vercel cold starts AND be shared
// across regions, otherwise an attacker can simply hammer different edge
// nodes to multiply the budget. We use the Upstash Redis REST API (no
// long-lived TCP connections — friendly to serverless cold starts) when
// UPSTASH_REDIS_REST_URL is configured, and fall back to per-instance
// memory for local dev so `npm run dev` doesn't require a Redis up.
//
// Why Upstash REST and not @vercel/kv directly: KV is just Upstash Redis
// rebranded and the REST contract is identical, so the same code paths
// work in either Vercel Marketplace setup. Set UPSTASH_REDIS_REST_URL +
// UPSTASH_REDIS_REST_TOKEN (Vercel KV's `KV_REST_API_URL` / `KV_REST_API_TOKEN`
// are aliased below) and the limiter goes persistent automatically.

const UPSTASH_URL =
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.KV_REST_API_URL ||
  "";
const UPSTASH_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.KV_REST_API_TOKEN ||
  "";

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimitMemory(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const hit = rateBuckets.get(key);
  if (!hit || now > hit.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (hit.count >= limit) return false;
  hit.count += 1;
  return true;
}

/**
 * Upstash Redis: INCR the key; if the result is 1 (just created) set TTL.
 * Returns true when allowed. Best-effort fire-and-forget on the TTL call so
 * a brief Upstash hiccup never blocks a login.
 *
 * Pipeline payload is built defensively — JSON.stringify of nested string
 * arrays is what the Upstash REST API expects, the response is
 * `[{ result: <int> }, { result: "OK" }]`.
 */
async function checkRateLimitUpstash(key: string, limit: number, windowMs: number): Promise<boolean> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return checkRateLimitMemory(key, limit, windowMs);
  const ttlSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  const fullKey = "ratelimit:" + key;
  try {
    const res = await fetch(UPSTASH_URL.replace(/\/$/, "") + "/pipeline", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + UPSTASH_TOKEN,
        "Content-Type": "application/json"
      },
      // 1) INCR — atomic count bump
      // 2) EXPIRE NX — set TTL only if the key was just born (NX flag avoids
      //    clobbering an existing window every request)
      body: JSON.stringify([
        ["INCR", fullKey],
        ["EXPIRE", fullKey, String(ttlSeconds), "NX"]
      ]),
      // Short timeout so a hung Upstash never blocks the request — the
      // memory fallback kicks in on failure.
      signal: AbortSignal.timeout(750)
    });
    if (!res.ok) return checkRateLimitMemory(key, limit, windowMs);
    const data = (await res.json()) as Array<{ result?: number | string }>;
    const count = Number(data?.[0]?.result || 0);
    return count <= limit;
  } catch {
    return checkRateLimitMemory(key, limit, windowMs);
  }
}

/**
 * Per-instance sliding-window limiter (abuse mitigation on serverless).
 * Returns true when the request is allowed.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  return checkRateLimitMemory(key, limit, windowMs);
}

export async function checkRateLimitPersistent(
  key: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    return checkRateLimitUpstash(key, limit, windowMs);
  }
  return checkRateLimitMemory(key, limit, windowMs);
}

export function clientIpFromRequest(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

/**
 * Synchronous limiter — fine for low-traffic routes where the in-memory bucket
 * is acceptable. New code that protects login / password-reset / signup MUST
 * call `enforceRateLimitPersistent` so the budget survives across regions.
 */
export function enforceRateLimit(
  req: NextRequest,
  routeKey: string,
  limit: number,
  windowMs: number
): void {
  const ip = clientIpFromRequest(req);
  const key = `${routeKey}:${ip}`;
  if (!checkRateLimit(key, limit, windowMs)) {
    throw forbidden("Too many requests — try again shortly");
  }
}

export async function enforceRateLimitPersistent(
  req: NextRequest,
  routeKey: string,
  limit: number,
  windowMs: number
): Promise<void> {
  const ip = clientIpFromRequest(req);
  const key = `${routeKey}:${ip}`;
  const ok = await checkRateLimitPersistent(key, limit, windowMs);
  if (!ok) throw forbidden("Too many requests — try again shortly");
}

const BLOCKED_UPLOAD_EXTENSIONS = [
  ".html",
  ".htm",
  ".svg",
  ".js",
  ".mjs",
  ".cjs",
  ".php",
  ".exe",
  ".sh",
  ".bat",
  ".cmd",
  ".ps1",
  ".vbs",
  ".jar",
  ".env"
];

export function hasBlockedUploadExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return BLOCKED_UPLOAD_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** @deprecated Import from `@/utils/searchTerm` — re-exported for compatibility. */
export { sanitizeSearchTerm } from "@/utils/searchTerm";
