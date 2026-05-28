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

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Per-instance sliding-window limiter (abuse mitigation on serverless).
 * Returns true when the request is allowed.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
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

export function clientIpFromRequest(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

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

/**
 * Sanitises a user-supplied search term before it is interpolated into a
 * PostgREST `.or(...)` filter string.
 *
 * The supabase-js client only URL-encodes the comma-separated list it
 * receives — it does NOT escape the commas / parens that act as PostgREST
 * structural syntax. That means a raw `q` containing `,` or `)(` could
 * break out of one `ilike` clause and inject extra `and(...)` / `or(...)`
 * predicates. RLS still applies (so the blast radius is row-filter bypass,
 * not full table read), but tightening here removes the entire class.
 *
 * We also drop `%` (the ilike wildcard) and `*` (the PostgREST glob) so
 * a single character can't turn an `.ilike('%a%')` into `'%%%'` which the
 * DB plans as a full table scan, and cap the term length so the OR list
 * stays well under the PostgREST URL length limit (~8 KB).
 */
export function sanitizeSearchTerm(raw: string | null | undefined, maxLength = 64): string {
  if (raw == null) return "";
  const trimmed = String(raw).trim();
  if (!trimmed) return "";
  const stripped = trimmed.replace(/[,()*%\\]/g, "");
  return stripped.slice(0, maxLength);
}
