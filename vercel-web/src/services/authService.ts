/**
 * Authentication-domain service.
 *
 * Right now this service owns one operation:
 *
 *   `logout(actor, scope?)` — POSTs to GoTrue `/auth/v1/logout?scope={scope}`
 *   with the caller's JWT, which revokes the user's refresh token(s) per
 *   the requested scope (`global` = every device, `local` = this device
 *   only, `others` = every other device). An audit row is appended so
 *   admins can correlate the click with the disappearance of an active
 *   session even when the revoke fails.
 *
 * Why a service (and not just inline-in-route)?
 *   Layering tests in `src/integration/__tests__/architecture.boundaries`
 *   forbid `app/api/*` routes from importing `@/database/*` or
 *   `@/lib/api/supabase` directly. The logout flow needs both an audit
 *   write (`auditRepository`) and a server-side HTTP call to GoTrue; the
 *   service is the single layer allowed to touch both.
 *
 * The raw `fetch` to GoTrue mirrors the pattern in
 * `app/api/v1/auth/login/route.ts` so we keep one consistent way of
 * speaking to GoTrue from the server (no `@/lib/api/supabase` import in
 * this file, per the boundary test for `src/services/*`).
 */

import type { ApiResult } from "@/types/common";
import { ErrorCodes } from "@/types/common";
import { auditRepository } from "@/database/auditRepository";
import { userRepository } from "@/database/userRepository";
import { env } from "@/lib/api/env";
import {
  fetchWithLoginTimeout,
  isUpstreamAuthBody,
  isUpstreamHttpStatus,
  loginUpstreamMessage
} from "@/lib/auth/loginUpstream";
import { failure, success } from "@/utils/apiResponse";

export type LogoutScope = "global" | "local" | "others";

export interface AuthServiceActor {
  userId: string;
  email: string;
  accessToken: string;
}

export interface LogoutMeta {
  /** Forwarded for the audit row; do not log raw header values elsewhere. */
  ip?: string | null;
  user_agent?: string | null;
}

export interface LogoutResult {
  revoked: boolean;
  scope: LogoutScope;
  revoke_error?: string | null;
}

export interface LoginSessionResult {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  expires_at: number;
  user: { id: string; email: string };
}

const DEFAULT_SCOPE: LogoutScope = "global";

function isLookupUpstreamFailure(message: string): boolean {
  const lower = String(message || "").toLowerCase();
  return /timeout|timed out|deadline|unavailable|fetch failed|network|econnreset/.test(lower);
}

async function signInWithPassword(
  email: string,
  password: string
): Promise<
  | { ok: true; body: LoginSessionResult & { refresh_token: string } }
  | { ok: false; upstream: boolean; message: string }
> {
  const tokenUrl = env.supabaseUrl.replace(/\/$/, "") + "/auth/v1/token?grant_type=password";
  const payload = JSON.stringify({ email, password });
  const headers = {
    apikey: env.supabaseAnonKey,
    "Content-Type": "application/json"
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const tokenRes = await fetchWithLoginTimeout(tokenUrl, {
      method: "POST",
      headers,
      body: payload
    });
    const tokenBody = (await tokenRes.json().catch(() => ({}))) as LoginSessionResult & {
      refresh_token?: string;
      error_description?: string;
      msg?: string;
      error_code?: string;
      error?: string;
      code?: string;
    };
    if (tokenRes.ok && tokenBody?.access_token) {
      return {
        ok: true,
        body: {
          access_token: tokenBody.access_token,
          refresh_token: tokenBody.refresh_token || "",
          expires_in: tokenBody.expires_in,
          expires_at: tokenBody.expires_at,
          user: tokenBody.user
        }
      };
    }
    const upstream =
      isUpstreamHttpStatus(tokenRes.status) ||
      isUpstreamAuthBody(tokenBody as unknown as Record<string, unknown>);
    if (upstream && attempt === 0) {
      await new Promise(function (resolve) {
        setTimeout(resolve, 600);
      });
      continue;
    }
    if (upstream) {
      return { ok: false, upstream: true, message: loginUpstreamMessage() };
    }
    return {
      ok: false,
      upstream: false,
      message: tokenBody.error_description || tokenBody.msg || "Invalid username or password"
    };
  }
  return { ok: false, upstream: true, message: loginUpstreamMessage() };
}

function resolveScope(input: unknown): LogoutScope {
  if (input === "local" || input === "others" || input === "global") return input;
  return DEFAULT_SCOPE;
}

async function revokeViaGoTrue(actor: AuthServiceActor, scope: LogoutScope): Promise<string | null> {
  // GoTrue's `/auth/v1/logout?scope=<scope>` with the user's JWT in the
  // Authorization header is the canonical "this user signs themselves
  // out" flow. It honors the scope so a "global" revoke invalidates
  // every refresh token attached to the user, not just this device's.
  const url = env.supabaseUrl.replace(/\/$/, "") + `/auth/v1/logout?scope=${encodeURIComponent(scope)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: env.supabaseAnonKey,
        Authorization: `Bearer ${actor.accessToken}`,
        "Content-Type": "application/json"
      }
    });
    if (!res.ok && res.status !== 204) {
      // GoTrue commonly returns 204; treat 2xx / 204 as success.
      const text = await res.text().catch(() => "");
      return `GoTrue logout failed (HTTP ${res.status})${text ? ": " + text.slice(0, 200) : ""}`;
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Revoke request failed";
  }
}

export const authService = {
  async login(identifier: string, password: string): Promise<ApiResult<LoginSessionResult>> {
    const lookup = await userRepository.resolveLoginEmail(identifier);
    if (!lookup.success) {
      if (lookup.code === ErrorCodes.database && isLookupUpstreamFailure(lookup.error || "")) {
        return failure(loginUpstreamMessage(), ErrorCodes.upstream);
      }
      return failure(loginUpstreamMessage(), ErrorCodes.upstream);
    }

    const email = lookup.data;
    if (!email) {
      await fetchWithLoginTimeout(
        env.supabaseUrl.replace(/\/$/, "") + "/auth/v1/token?grant_type=password",
        {
          method: "POST",
          headers: {
            apikey: env.supabaseAnonKey,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ email: "no-such-user@example.invalid", password })
        }
      ).catch(function () {
        return undefined;
      });
      return failure("Invalid username or password", ErrorCodes.unauthorized);
    }

    const signIn = await signInWithPassword(email, password);
    if (!signIn.ok) {
      if (signIn.upstream) {
        return failure(signIn.message, ErrorCodes.upstream);
      }
      return failure(signIn.message, ErrorCodes.unauthorized);
    }

    const tokenBody = signIn.body;
    return success({
      access_token: tokenBody.access_token,
      refresh_token: tokenBody.refresh_token,
      expires_in: tokenBody.expires_in,
      expires_at: tokenBody.expires_at,
      user: tokenBody.user
    });
  },

  /**
   * Revoke the caller's session(s) server-side. Always returns success
   * (with `revoked: false` and an error string when the underlying call
   * failed) so the caller can still complete its local-state clear
   * regardless of GoTrue availability.
   */
  async logout(
    actor: AuthServiceActor,
    scopeInput: unknown,
    meta: LogoutMeta = {}
  ): Promise<ApiResult<LogoutResult>> {
    if (!actor.accessToken) {
      // Defensive — `withAuth` guarantees this, but a future caller
      // bypassing the wrapper would otherwise hit GoTrue with an empty
      // Bearer and get a misleading 401 we'd misclassify as "ok".
      return failure("logout requires an authenticated actor", ErrorCodes.unauthorized);
    }
    const scope = resolveScope(scopeInput);
    const revokeError = await revokeViaGoTrue(actor, scope);

    await auditRepository
      .insert({
        module: "auth",
        entity_id: actor.userId,
        action: "logout",
        actor: actor.email,
        user_id: actor.userId,
        stamp: `logout (${scope}) by ${actor.email}`,
        payload: {
          scope,
          revoke_error: revokeError,
          ip: meta.ip ?? null,
          user_agent: meta.user_agent ?? null
        }
      })
      .catch(() => undefined);

    return success({
      revoked: revokeError === null,
      scope,
      revoke_error: revokeError
    });
  }
};
