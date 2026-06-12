import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/** HttpOnly refresh token cookie — never exposed in login JSON (P1-42). */
export const REFRESH_COOKIE_NAME = "hhcrm_refresh";

/**
 * Non-secret flag the browser can read (P1-D). Set/cleared with the refresh
 * cookie so bootstrap skips POST /auth/refresh for logged-out visitors.
 */
export const SESSION_HINT_COOKIE_NAME = "hhcrm_session";

const DEFAULT_REFRESH_MAX_AGE_SEC = 60 * 60 * 24 * 7;

function sessionHintCookieOptions(maxAge: number) {
  return {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge
  };
}

export function refreshCookieMaxAge(expiresInSec?: number): number {
  if (typeof expiresInSec === "number" && expiresInSec > 0) {
    return Math.min(expiresInSec, DEFAULT_REFRESH_MAX_AGE_SEC);
  }
  return DEFAULT_REFRESH_MAX_AGE_SEC;
}

export function readRefreshCookie(req: NextRequest): string | null {
  const value = req.cookies.get(REFRESH_COOKIE_NAME)?.value;
  return value && value.trim() ? value.trim() : null;
}

export function attachRefreshCookie(
  response: NextResponse,
  refreshToken: string,
  expiresInSec?: number
): NextResponse {
  const maxAge = refreshCookieMaxAge(expiresInSec);
  response.cookies.set(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge
  });
  response.cookies.set(SESSION_HINT_COOKIE_NAME, "1", sessionHintCookieOptions(maxAge));
  return response;
}

export function clearRefreshCookie(response: NextResponse): NextResponse {
  response.cookies.set(REFRESH_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0
  });
  response.cookies.set(SESSION_HINT_COOKIE_NAME, "", sessionHintCookieOptions(0));
  return response;
}
