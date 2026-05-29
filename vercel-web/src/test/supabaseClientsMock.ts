/**
 * Shared Supabase client mock for integration tests.
 *
 * Both `@/lib/api/supabase` and `@/database/clients` must resolve to the
 * same singleton so auth, idempotency, and repositories see one in-memory DB.
 */
import { buildSupabaseMock } from "@/test/routeHarness";

const shared = buildSupabaseMock();

export const supabaseAdmin = shared.supabaseAdmin;
export const supabaseAsUser = shared.supabaseAsUser;
export const dbFor = shared.dbFor;

/** Alias used by `src/database/supabaseClient.ts` and repositories. */
export const adminClient = shared.supabaseAdmin;
