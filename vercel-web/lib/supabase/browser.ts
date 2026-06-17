import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolveSupabaseUrl } from "@/lib/supabase/resolveSupabaseUrl";

let browserClient: SupabaseClient | null = null;

/**
 * Read a NEXT_PUBLIC_* variable for the browser bundle.
 *
 * Next.js only inlines `process.env.NEXT_PUBLIC_FOO` when the key is a
 * static string literal at build time. Dynamic access like
 * `process.env[name]` is always undefined in the client bundle, which
 * caused "Missing NEXT_PUBLIC_SUPABASE_URL" on every page after deploy.
 */
function readPublicEnv(name: string, value: string | undefined): string {
  if (!value || !String(value).trim()) {
    throw new Error(
      "Missing " +
        name +
        ". Set it in Vercel → Environment Variables (and .env.local for local dev)."
    );
  }
  return String(value).trim();
}

/** Singleton browser Supabase client (anon key). */
export function getBrowserSupabase(): SupabaseClient {
  if (!browserClient) {
    const configuredUrl = readPublicEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL
    );
    const supabaseAnonKey = readPublicEnv(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
    const { url: supabaseUrl } = resolveSupabaseUrl(configuredUrl, supabaseAnonKey);
    // CRM auth uses HttpOnly refresh cookies + /api/v1/auth/* — not Supabase
    // browser sessions. Disable auto-refresh so stale localStorage sessions cannot
    // storm GoTrue during database outages.
    browserClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
      }
    });
  }
  return browserClient;
}

export type BrowserSupabaseClient = SupabaseClient;
