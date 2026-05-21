import type { NextRequest } from "next/server";
import { supabaseAdmin } from "./supabase";
import { forbidden, unauthorized } from "./errors";

export type AppRole = "Admin" | "Manager" | "Staff" | "Accountant" | "Nurse" | string;

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
 * Validates the caller's Supabase JWT, loads the matching hh_users row,
 * and returns an ActorContext. Throws 401/403 on failure.
 */
export async function requireActor(req: NextRequest): Promise<ActorContext> {
  const accessToken = extractBearer(req);
  const admin = supabaseAdmin();

  const { data: userData, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !userData?.user) throw unauthorized("Invalid session");

  const email = (userData.user.email || "").toLowerCase();
  if (!email) throw unauthorized("Session has no email");

  const { data: appUser, error: appErr } = await admin
    .from("hh_users")
    .select("id, username, email, role, is_active")
    .ilike("email", email)
    .eq("is_active", true)
    .maybeSingle();
  if (appErr) throw unauthorized(appErr.message);
  if (!appUser) throw forbidden("Account is not provisioned in CRM (hh_users)");

  return {
    userId: appUser.id,
    email,
    username: appUser.username || email,
    role: appUser.role || "Staff",
    accessToken
  };
}

export function requireRole(actor: ActorContext, allowed: AppRole[]): void {
  const role = (actor.role || "").toLowerCase();
  const ok = allowed.some((r) => r.toLowerCase() === role);
  if (!ok) throw forbidden(`Requires role: ${allowed.join(" | ")}`);
}
