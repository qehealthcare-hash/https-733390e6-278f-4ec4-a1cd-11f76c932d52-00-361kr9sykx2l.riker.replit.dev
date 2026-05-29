import { NextResponse, type NextRequest } from "next/server";
import { jsonError } from "./errors";
import { requireActor, type ActorContext } from "./auth";

/** Next 15 passes `params` as a Promise. */
export type NextRouteContext<P> = { params: Promise<P> };

type Handler<P> = (
  req: NextRequest,
  ctx: { params: P; actor: ActorContext }
) => Promise<NextResponse> | NextResponse;

type RawHandler<P> = (
  req: NextRequest,
  ctx: { params: P }
) => Promise<NextResponse> | NextResponse;

/**
 * Wraps a route handler with auth + uniform error envelope.
 * Resolves Next 15's dynamic-params Promise and provides actor.
 */
export function withAuth<P = Record<string, string>>(handler: Handler<P>) {
  return async (req: NextRequest, ctx: NextRouteContext<P>) => {
    try {
      const actor = await requireActor(req);
      const params = (await ctx?.params) ?? ({} as P);
      return await handler(req, { params, actor });
    } catch (err) {
      return jsonError(err);
    }
  };
}

/**
 * Like withAuth but skips authentication. Use for webhook endpoints
 * that authenticate via signed payloads.
 */
export function withoutAuth<P = Record<string, string>>(handler: RawHandler<P>) {
  return async (req: NextRequest, ctx: NextRouteContext<P>) => {
    try {
      const params = (await ctx?.params) ?? ({} as P);
      return await handler(req, { params });
    } catch (err) {
      return jsonError(err);
    }
  };
}

import { badRequest } from "./errors";
import { MAX_JSON_BODY_BYTES } from "./security";

export async function parseJsonBody<T extends Record<string, unknown> = Record<string, unknown>>(
  req: NextRequest
): Promise<T> {
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > MAX_JSON_BODY_BYTES) {
    throw badRequest(`Request body too large (max ${MAX_JSON_BODY_BYTES} bytes)`);
  }
  const text = await req.text();
  if (text.length > MAX_JSON_BODY_BYTES) {
    throw badRequest(`Request body too large (max ${MAX_JSON_BODY_BYTES} bytes)`);
  }
  // P1-34: an empty body used to be silently coerced to an empty object,
  // which then sailed through Zod schemas where every field was optional
  // and produced phantom no-op writes (audit log noise, stale updated_at).
  // The cited routes (duties diary PATCH, inquiry convert) ALL require a
  // body — and so do most POST/PATCH/PUT endpoints. Throw a real
  // badRequest("Body required") so callers see the failure. GET-with-body
  // is not a thing in this app; the few legitimate empty-POST routes pass
  // an explicit minimal payload from the client.
  if (!text) {
    throw badRequest("Body required");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw badRequest("Body must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw badRequest("Body must be a JSON object");
  }
  return parsed as T;
}

export function pageParams(req: NextRequest): { limit: number; offset: number; q: string } {
  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), 500);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);
  const q = (url.searchParams.get("q") || "").trim();
  return { limit, offset, q };
}
