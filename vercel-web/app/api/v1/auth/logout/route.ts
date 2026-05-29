import type { NextRequest } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/api/handler";
import { authService } from "@/services/authService";
import { respond } from "@/lib/api/apiResultBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * M1-C1: Server-side logout.
 *
 * Why this route exists:
 *   `supabase.auth.signOut()` in the browser only clears local storage.
 *   The refresh token issued by GoTrue stays valid for its full TTL
 *   (default 7 days) so a leaked token could keep minting access tokens
 *   until natural expiry. This route forwards the user's JWT to
 *   `authService.logout()`, which calls GoTrue's `/auth/v1/logout?scope=…`
 *   server-side and appends an audit row.
 *
 * Body shape (all optional):
 *   { scope?: 'global' | 'local' | 'others' }   // default 'global'
 *
 * The route requires a valid bearer token (`withAuth`) so an attacker
 * cannot revoke another user's sessions. If the caller's token is already
 * expired they're effectively logged out anyway — the browser falls back
 * to a local-only clear, which is fine.
 */

const logoutSchema = z.object({
  scope: z.enum(["global", "local", "others"]).optional()
});

async function safeReadBody(req: NextRequest): Promise<{ scope?: "global" | "local" | "others" }> {
  try {
    const text = await req.text();
    if (!text) return {};
    const json: unknown = JSON.parse(text);
    if (!json || typeof json !== "object" || Array.isArray(json)) return {};
    const parsed = logoutSchema.safeParse(json);
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export const POST = withAuth(async (req, { actor }) => {
  const { scope } = await safeReadBody(req);

  const result = await authService.logout(
    {
      userId: actor.userId,
      email: actor.email,
      accessToken: actor.accessToken
    },
    scope,
    {
      ip:
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        null,
      user_agent: req.headers.get("user-agent") || null
    }
  );

  return respond(result);
});
