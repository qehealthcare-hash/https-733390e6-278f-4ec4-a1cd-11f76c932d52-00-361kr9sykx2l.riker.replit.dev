import type { NextRequest } from "next/server";
import { userRepository } from "@/database/userRepository";
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
  const resolved = await userRepository.resolveActorFromToken(accessToken);
  if (!resolved.success) throw unauthorized(resolved.error || "Invalid session");
  if (!resolved.data) throw forbidden("Account is not provisioned in CRM (hh_users)");

  const appUser = resolved.data;
  return {
    userId: appUser.userId,
    email: appUser.email,
    username: appUser.username,
    role: appUser.role,
    accessToken
  };
}

export function requireRole(actor: ActorContext, allowed: AppRole[]): void {
  const role = (actor.role || "").toLowerCase();
  const ok = allowed.some((r) => r.toLowerCase() === role);
  if (!ok) throw forbidden(`Requires role: ${allowed.join(" | ")}`);
}
