/**
 * IP rate limiting — Upstash Redis in production, in-memory fallback locally.
 */

import { getRedis } from "@/lib/upstash";

const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimitMemory(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || now > entry.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }

  if (entry.count >= limit) {
    return {
      ok: false,
      retryAfterSec: Math.ceil((entry.resetAt - now) / 1000),
    };
  }

  entry.count += 1;
  return { ok: true };
}

/** @deprecated Prefer `rateLimitRequest` in API routes. */
export function rateLimit(
  key: string,
  limit = 5,
  windowMs = 60_000,
): { ok: boolean; retryAfterSec?: number } {
  return rateLimitMemory(key, limit, windowMs);
}

export async function rateLimitRequest(
  key: string,
  limit = 5,
  windowMs = 60_000,
): Promise<{ ok: boolean; retryAfterSec?: number }> {
  const redis = getRedis();
  if (!redis) {
    return rateLimitMemory(key, limit, windowMs);
  }

  const windowSec = Math.max(1, Math.ceil(windowMs / 1000));
  const redisKey = `rl:${key}`;

  try {
    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.expire(redisKey, windowSec);
    }
    if (count > limit) {
      const ttl = await redis.ttl(redisKey);
      return {
        ok: false,
        retryAfterSec: ttl > 0 ? ttl : windowSec,
      };
    }
    return { ok: true };
  } catch (err) {
    console.error("[rate-limit] Upstash error, falling back to memory", err);
    return rateLimitMemory(key, limit, windowMs);
  }
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? "unknown";
  return request.headers.get("x-real-ip") ?? "unknown";
}
