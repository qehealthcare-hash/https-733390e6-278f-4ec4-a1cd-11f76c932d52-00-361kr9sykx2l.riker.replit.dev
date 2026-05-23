import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let serviceClient: SupabaseClient | null = null;

/**
 * Server-only Supabase client backed by the SERVICE_ROLE key.
 * Bypasses RLS — use ONLY in API routes after authenticating the caller via JWT.
 */
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

/**
 * Per-request client that carries the user's JWT, so RLS applies.
 * Pass the bearer token from the Authorization header.
 */
export function supabaseAsUser(accessToken: string): SupabaseClient {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

/**
 * Helper for legacy `lib/api/services/*` modules: pick the user-scoped client
 * when an access token is available so RLS applies; otherwise fall back to the
 * service-role admin client. This lets us migrate routes incrementally — any
 * route that passes `actor.accessToken` immediately runs under the caller's
 * RLS policies instead of bypassing them via `supabaseAdmin()`.
 */
export function dbFor(accessToken?: string | null): SupabaseClient {
  if (accessToken) return supabaseAsUser(accessToken);
  return supabaseAdmin();
}
