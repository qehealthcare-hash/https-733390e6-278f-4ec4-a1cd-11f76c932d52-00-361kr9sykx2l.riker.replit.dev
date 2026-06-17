/**
 * Supabase client factory — single SDK connection pool for the database layer.
 *
 * `lib/api/supabase.ts` re-exports these helpers for route/middleware code that
 * has not yet been migrated behind repositories.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/api/env";

const SUPABASE_FETCH_TIMEOUT_MS = Number(process.env.SUPABASE_FETCH_TIMEOUT_MS || 20_000);

function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const timeoutMs = SUPABASE_FETCH_TIMEOUT_MS;
  const signal =
    init?.signal ??
    (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
      ? AbortSignal.timeout(timeoutMs)
      : undefined);
  return fetch(input, { ...init, signal });
}

let serviceClient: SupabaseClient | null = null;

/** Server-only client backed by the SERVICE_ROLE key (bypasses RLS). */
export function supabaseAdmin(): SupabaseClient {
  if (serviceClient) return serviceClient;
  if (!env.supabaseServiceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }
  serviceClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: fetchWithTimeout }
  });
  return serviceClient;
}

/** Per-request client carrying the user's JWT (RLS applies). */
export function supabaseAsUser(accessToken: string): SupabaseClient {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` }, fetch: fetchWithTimeout },
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
    global: { headers, fetch: fetchWithTimeout },
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
