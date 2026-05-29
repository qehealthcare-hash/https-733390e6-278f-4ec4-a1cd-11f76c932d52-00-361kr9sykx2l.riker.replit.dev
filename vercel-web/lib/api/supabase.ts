/**
 * Re-exports the database-layer Supabase client factory.
 *
 * Prefer `@/database/clients` in new code. This module remains so existing
 * route mocks (`vi.mock("@/lib/api/supabase")`) and middleware keep working.
 */
export { supabaseAdmin, supabaseAsUser, dbFor } from "@/database/clients";
