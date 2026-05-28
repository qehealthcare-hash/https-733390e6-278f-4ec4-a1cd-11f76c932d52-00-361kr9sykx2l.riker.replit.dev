/**
 * Single source of truth for Supabase clients in the new architecture.
 *
 * Two distinct clients:
 *   - `adminClient()` — SERVICE_ROLE key, bypasses RLS. Use ONLY from server
 *     code after the caller has been authenticated by middleware.
 *   - `userClient(accessToken)` — anon key + caller JWT, RLS applies.
 *
 * Repositories (in /src/database/*) MUST go through these helpers. Never
 * import `@supabase/supabase-js` directly elsewhere.
 *
 * Client factories live in `@/database/clients` (single SDK connection pool).
 */

import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import {
  adminClient as legacyAdmin,
  supabaseAsUser as legacyAsUser
} from "@/database/clients";
import type { ApiResult } from "@/types/common";
import { dbFailure } from "@/utils/apiResponse";

/** Server-only admin client (bypasses RLS). */
export function adminClient(): SupabaseClient {
  return legacyAdmin();
}

/** Per-request client carrying the caller's JWT (RLS applies). */
export function userClient(accessToken: string): SupabaseClient {
  return legacyAsUser(accessToken);
}

/**
 * Wrap a Supabase query promise into an ApiResult so repositories never have
 * to handle `{ data, error }` tuples manually.
 *
 *   const result = await runQuery(
 *     () => adminClient().from("hh_patients").select("*").eq("id", id).maybeSingle(),
 *     "patient.findById"
 *   );
 */
export async function runQuery<T>(
  fn: () => PromiseLike<{ data: T | null; error: PostgrestError | null }>,
  scope: string
): Promise<ApiResult<T | null>> {
  try {
    const { data, error } = await fn();
    if (error) {
      return dbFailure(error.message, {
        scope,
        code: error.code,
        hint: error.hint,
        details: error.details
      });
    }
    return { success: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database call failed";
    return dbFailure(message, { scope });
  }
}

/** Helper for queries that always return an array. */
export async function runListQuery<T>(
  fn: () => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
  scope: string
): Promise<ApiResult<T[]>> {
  const result = await runQuery<T[]>(fn, scope);
  if (!result.success) return result as ApiResult<T[]>;
  return { success: true, data: result.data ?? [] };
}

/**
 * Repository helper: detect a Postgres unique-violation error and return a
 * duplicate ApiResult with the offending column name (parsed from PG message).
 */
export function isUniqueViolation(err: { code?: string } | null | undefined): boolean {
  return !!err && err.code === "23505";
}
