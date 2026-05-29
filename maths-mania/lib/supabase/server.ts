import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/config";

/**
 * Server Supabase client with cookie-backed session (for App Router).
 * Returns null when env is not configured — callers should degrade gracefully.
 */
export async function createClient() {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();
  if (!url || !key) return null;

  const cookieStore = await cookies();

  return createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // setAll from a Server Component — middleware will refresh session
        }
      },
    },
  });
}
