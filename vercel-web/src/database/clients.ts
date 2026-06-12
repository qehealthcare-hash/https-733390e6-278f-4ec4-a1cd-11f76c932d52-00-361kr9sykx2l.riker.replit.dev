/**
 * Supabase client factory — single SDK connection pool for the database layer.
 *
 * `lib/api/supabase.ts` re-exports these helpers for route/middleware code that
 * has not yet been migrated behind repositories.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/api/env";

let serviceClient: SupabaseClient | null = null;

/** Server-only client backed by the SERVICE_ROLE key (bypasses RLS). */
export function supabaseAdmin(): SupabaseClient {
  if (serviceClient) return serviceClient;
  if (!env.supabaseServiceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }
  serviceClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  return serviceClient;
}

/** Per-request client carrying the user's JWT (RLS applies). */
export function supabaseAsUser(accessToken: string): SupabaseClient {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

/**
 * Client for SECURITY DEFINER business RPCs (EXECUTE granted to service_role only).
 * When `accessToken` is set, the user JWT is forwarded in Authorization so
 * `auth.jwt()` / `hh_has_role()` inside RPC bodies still enforce app roles.
 */
export function supabaseRpcAsService(accessToken?: string | null): SupabaseClient {
  if (!env.supabaseServiceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }
  const headers: Record<string, string> = {};
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    global: { headers },
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

/**
 * Pick user-scoped client when a bearer token is present; otherwise admin.
 * Used while migrating routes incrementally to always pass `accessToken`.
 */
export function dbFor(accessToken?: string | null): SupabaseClient {
  if (accessToken) return supabaseAsUser(accessToken);
  return supabaseAdmin();
}

/** Alias matching `supabaseClient.adminClient()` naming in repositories. */
export function adminClient(): SupabaseClient {
  return supabaseAdmin();
}
