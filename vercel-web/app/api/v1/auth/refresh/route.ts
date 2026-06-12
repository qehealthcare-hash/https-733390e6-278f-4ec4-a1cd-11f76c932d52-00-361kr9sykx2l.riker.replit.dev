import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/errors";
import { success } from "@/utils/apiResponse";
import { env } from "@/lib/api/env";
import {
  attachRefreshCookie,
  clearRefreshCookie,
  readRefreshCookie
} from "@/lib/auth/refreshCookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RefreshTokenBody = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  error_description?: string;
  msg?: string;
};

/**
 * POST /api/v1/auth/refresh
 *
 * Rotates the session using the HttpOnly refresh cookie set at login.
 * Returns a new access token only — refresh token never appears in JSON.
 */
export async function POST(req: NextRequest) {
  try {
    const refreshToken = readRefreshCookie(req);
    if (!refreshToken) {
      const response = NextResponse.json(
        { success: false, error: "No refresh session", code: "unauthorized" },
        { status: 401 }
      );
      return clearRefreshCookie(response);
    }

    const tokenRes = await fetch(
      env.supabaseUrl.replace(/\/$/, "") + "/auth/v1/token?grant_type=refresh_token",
      {
        method: "POST",
        headers: {
          apikey: env.supabaseAnonKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ refresh_token: refreshToken })
      }
    );
    const tokenBody = (await tokenRes.json().catch(() => ({}))) as RefreshTokenBody;
    if (!tokenRes.ok || !tokenBody.access_token) {
      const response = NextResponse.json(
        {
          success: false,
          error: tokenBody.error_description || tokenBody.msg || "Session expired",
          code: "unauthorized"
        },
        { status: 401 }
      );
      return clearRefreshCookie(response);
    }

    const nextRefresh = tokenBody.refresh_token || refreshToken;
    const response = NextResponse.json(
      success({
        access_token: tokenBody.access_token,
        expires_in: tokenBody.expires_in,
        expires_at: tokenBody.expires_at
      })
    );
    attachRefreshCookie(response, nextRefresh, tokenBody.expires_in);
    return response;
  } catch (err) {
    return jsonError(err);
  }
}
