import { createClient } from "@supabase/supabase-js";

let browserClient = null;

function requirePublicEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(
      `Missing ${name}. Set it in Vercel → Environment Variables (and .env.local for local dev).`
    );
  }
  return String(value).trim();
}

export function getBrowserSupabase() {
  if (!browserClient) {
    const supabaseUrl = requirePublicEnv("NEXT_PUBLIC_SUPABASE_URL");
    const supabaseAnonKey = requirePublicEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    browserClient = createClient(supabaseUrl, supabaseAnonKey);
  }
  return browserClient;
}
