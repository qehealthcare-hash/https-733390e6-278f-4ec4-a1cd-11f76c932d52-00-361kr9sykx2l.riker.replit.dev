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
