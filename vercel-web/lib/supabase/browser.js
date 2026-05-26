import { createClient } from "@supabase/supabase-js";

let browserClient = null;

/**
 * Read a NEXT_PUBLIC_* variable for the browser bundle.
 *
 * Next.js only inlines `process.env.NEXT_PUBLIC_FOO` when the key is a
 * static string literal at build time. Dynamic access like
 * `process.env[name]` is always undefined in the client bundle, which
 * caused "Missing NEXT_PUBLIC_SUPABASE_URL" on every page after deploy.
 */
function readPublicEnv(name, value) {
  if (!value || !String(value).trim()) {
    throw new Error(
      "Missing " +
        name +
        ". Set it in Vercel → Environment Variables (and .env.local for local dev)."
    );
  }
  return String(value).trim();
}

export function getBrowserSupabase() {
  if (!browserClient) {
    const supabaseUrl = readPublicEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL
    );
    const supabaseAnonKey = readPublicEnv(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
    browserClient = createClient(supabaseUrl, supabaseAnonKey);
  }
  return browserClient;
}
