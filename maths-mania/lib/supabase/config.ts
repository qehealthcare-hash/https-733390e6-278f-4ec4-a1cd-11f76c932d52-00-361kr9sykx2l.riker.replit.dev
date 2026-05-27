/**
 * Supabase env helpers — safe to import from server or client bundles.
 * Never reads SUPABASE_SERVICE_ROLE_KEY here.
 */

export function getSupabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || undefined;
}

export function getSupabaseAnonKey(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || undefined;
}

/** True when browser/server clients can be created. */
export function isSupabaseConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}

/** True when server-only admin client can be created. */
export function isSupabaseAdminConfigured(): boolean {
  return Boolean(
    isSupabaseConfigured() &&
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
}
