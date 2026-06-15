import type { NextRequest } from "next/server";
import { z } from "zod";
import { parseJsonBody } from "@/lib/api/handler";
import { enforceRateLimitPersistent } from "@/lib/api/security";
import { badRequest, jsonError, unauthorized } from "@/lib/api/errors";
import { success } from "@/utils/apiResponse";
import { respondValidated } from "@/lib/api/apiResultBridge";
import { loginSessionDtoSchema } from "@/validation/authDto";
import { env } from "@/lib/api/env";
import { attachRefreshCookie } from "@/lib/auth/refreshCookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * P1-38 server-side login proxy.
 *
 * Why this route exists:
 *   * Browser used to call `supabase.auth.signInWithPassword` directly,
 *     which (a) routed credentials through Supabase's GoTrue without our
 *     limiter ever seeing the request and (b) required `hh_lookup_login`
 *     to expose `(email, username)` to every signed-in client so the
 *     iframe could resolve a username into an email before posting the
 *     password.
 *   * P1-14 collapsed `hh_lookup_login` to a boolean `(account_exists?)`
 *     and revoked it from `authenticated`. Username → email translation
 *     now happens in this route via the service-role-only helper
 *     `_hh_resolve_login_email`.
 *
 * Security guarantees:
 *   * enforceRateLimitPersistent applies once. It uses Upstash/Redis when
 *     configured and falls back to memory locally. Do not stack it with the
 *     synchronous limiter, otherwise the memory fallback counts one login
 *     attempt twice and locks an office IP out too quickly.
 *   * No body field is reflected back to the client on failure — we
 *     respond with a generic "Invalid credentials" to avoid leaking
 *     "this username exists, that one doesn't".
 *   * Credentials never touch this server's logs (no console.error of
 *     the body — just the username on a 4xx response).
 */

const loginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(1, "identifier is required")
    .max(254, "identifier is too long"),
  password: z.string().min(1, "password is required").max(256, "password is too long")
});

interface SupabaseAuthSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number;
  user: { id: string; email: string };
}

interface SupabaseAuthError {
  error_description?: string;
  msg?: string;
  message?: string;
}

async function resolveEmail(identifier: string): Promise<string | null> {
  if (identifier.includes("@")) return identifier.toLowerCase();
  if (!env.supabaseServiceRoleKey) return null;
  const url = env.supabaseUrl.replace(/\/$/, "") + "/rest/v1/rpc/_hh_resolve_login_email";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: env.supabaseServiceRoleKey,
      Authorization: "Bearer " + env.supabaseServiceRoleKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ login_input: identifier })
  });
  if (!res.ok) return null;
  const data: unknown = await res.json();
  if (typeof data === "string" && data) return data.toLowerCase();
  return null;
}

export async function POST(req: NextRequest) {
  try {
    // Office users commonly share one public IP; 20/minute prevents accidental
    // lockout while still throttling automated password spraying.
    await enforceRateLimitPersistent(req, "login-v2", 20, 60_000);

    const body = await parseJsonBody(req);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message || "Invalid credentials payload");
    }
    const { identifier, password } = parsed.data;

    const email = await resolveEmail(identifier);
    if (!email) {
      // Constant-time-ish: still hit GoTrue with a known-bad email so an
      // attacker can't time the username lookup vs. password check.
      await fetch(env.supabaseUrl.replace(/\/$/, "") + "/auth/v1/token?grant_type=password", {
        method: "POST",
        headers: {
          apikey: env.supabaseAnonKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email: "no-such-user@example.invalid", password })
      }).catch(() => undefined);
      throw unauthorized("Invalid username or password");
    }

    const tokenRes = await fetch(env.supabaseUrl.replace(/\/$/, "") + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: {
        apikey: env.supabaseAnonKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email, password })
    });
    const tokenBody = (await tokenRes.json().catch(() => ({}))) as SupabaseAuthSession & SupabaseAuthError;
    if (!tokenRes.ok || !tokenBody?.access_token) {
      throw unauthorized(tokenBody.error_description || tokenBody.msg || "Invalid username or password");
    }
    const response = respondValidated(
      success({
        access_token: tokenBody.access_token,
        expires_in: tokenBody.expires_in,
        expires_at: tokenBody.expires_at,
        user: tokenBody.user
      }),
      loginSessionDtoSchema
    );
    if (tokenBody.refresh_token) {
      return attachRefreshCookie(response, tokenBody.refresh_token, tokenBody.expires_in);
    }
    return response;
  } catch (err) {
    return jsonError(err);
  }
}
