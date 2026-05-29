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
import { env } from "@/lib/api/env";
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

const DEFAULT_SCOPE: LogoutScope = "global";

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
