import type { NextRequest } from "next/server";
import { userRepository } from "@/database/userRepository";
import { adminClient } from "@/database/supabaseClient";
import type { Role } from "@/business/rbac";
import { forbidden, unauthorized } from "./errors";

/**
 * M2-H1: `AppRole` is now the canonical `Role` union from
 * `@/business/rbac`. The legacy `| string` escape hatch was removed so
 * every `requireRole(actor, [...])` call is type-checked against the
 * known role catalogue. If you genuinely need to accept a custom DB
 * role label here, update `CANONICAL_ROLES` and the migration that
 * seeds it — there should be no other path.
 *
 * `actor.role` is still effectively runtime-typed (the JWT may carry
 * any string), but the static narrowing protects callers that pass
 * `allowed` literals.
 */
export type AppRole = Role;

export interface ActorContext {
  userId: string;
  email: string;
  username: string;
  role: AppRole;
  accessToken: string;
}

function extractBearer(req: NextRequest): string {
  const header = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const [scheme, token] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) {
    throw unauthorized("Missing or invalid Authorization header");
  }
  return token.trim();
}

/**
 * P1-37: look up the hh_users row by email with `.eq('email', X.toLowerCase())`,
 * never `.ilike`. The Auth user object holds the canonical email; we
 * normalize once here and again at the repository layer so the index is
 * actually used and we don't accidentally match partial patterns.
 *
 * Lookup is split between userRepository.resolveActorFromToken (which knows
 * how to join hh_users to hh_roles for the role label) and this fallback
 * `.eq("email", email.toLowerCase())` probe — kept here so the auth layer
 * stays grep-able for "where does the email match happen?" audits.
 */
async function loadAppUserByEmail(email: string) {
  const admin = adminClient();
  const lookup = await admin
    .from("hh_users")
    .select("id, email, username, is_active, role")
    .eq("email", email.toLowerCase())
    .eq("is_active", true)
    .maybeSingle();
  return lookup;
}

/**
 * Validates the caller's Supabase JWT, loads the matching hh_users row,
 * and returns an ActorContext. Throws 401/403 on failure.
 */
export async function requireActor(req: NextRequest): Promise<ActorContext> {
  const accessToken = extractBearer(req);
  const resolved = await userRepository.resolveActorFromToken(accessToken);
  if (!resolved.success) throw unauthorized(resolved.error || "Invalid session");
  if (!resolved.data) {
    // Sanity-check fallback path: confirm the row really is missing using
    // the same .eq("email", email.toLowerCase()) shape the repo uses, so a
    // bug in the join can't silently 403 a real user.
    const admin = adminClient();
    const { data: userData } = await admin.auth.getUser(accessToken);
    const email = (userData?.user?.email || "").toLowerCase();
    if (email) {
      const probe = await loadAppUserByEmail(email);
      if (probe.data) {
        throw forbidden(
          "Account exists in hh_users but the role join failed — contact an Admin"
        );
      }
    }
    throw forbidden("Account is not provisioned in CRM (hh_users)");
  }

  const appUser = resolved.data;
  // M2-H1: `appUser.role` is typed as `string` by the repository (the DB
  // column has no enum constraint), but our `AppRole` is narrow. We accept
  // the value as-is and rely on `requireRole(...)` to deny anything outside
  // CANONICAL_ROLES at runtime — exactly matching the original "if you
  // typo a role, you get 403" behaviour.
  return {
    userId: appUser.userId,
    email: appUser.email,
    username: appUser.username,
    role: appUser.role as AppRole,
    accessToken
  };
}

export function requireRole(actor: ActorContext, allowed: readonly AppRole[]): void {
  const role = (actor.role || "").toLowerCase();
  const ok = allowed.some((r) => r.toLowerCase() === role);
  if (!ok) throw forbidden(`Requires role: ${allowed.join(" | ")}`);
}
