import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  getSupabaseUrl,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/config";

/**
 * Service-role client — server-only. Bypasses RLS.
 * Use in API routes, webhooks, and cron jobs only.
 */
export function createAdminClient() {
  if (!isSupabaseAdminConfigured()) {
    throw new Error(
      "Supabase admin client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return createClient<Database>(
    getSupabaseUrl()!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

/**
 * Returns admin client or null (for dual-write routes that fall back to jsonl).
 */
export function tryCreateAdminClient() {
  if (!isSupabaseAdminConfigured()) return null;
  return createAdminClient();
}
