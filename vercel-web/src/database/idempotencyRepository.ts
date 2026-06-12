import type { ApiResult } from "@/types/common";
import { adminClient } from "@/database/clients";
import { runQuery } from "@/database/supabaseClient";

const TABLE = "hh_idempotency";
const SCOPE = "idempotencyRepository";

/**
 * All access uses `adminClient()` (service role). Table RLS allows only
 * `service_role` — see migration `20260601230000_r5_idempotency_auth_hardening.sql`.
 *
 * `hh_idempotency` schema (live):
 *   key text not null
 *   actor text not null
 *   route text not null
 *   response jsonb null
 *   status integer null default 200
 *   created_at timestamptz not null default now()
 *   primary key (key, actor)
 *
 * State machine:
 *   PENDING   — `status = 0` AND `response is null` — reserved row, handler
 *               is in-flight. `findCached` MUST exclude these so a concurrent
 *               second caller does not see a partial result.
 *   COMPLETED — `status > 0` AND `response` is the final body envelope.
 */

const PENDING_STATUS = 0;
const PENDING_STALE_MS = 30_000;

export interface IdempotencyCachedRow {
  response: Record<string, unknown> | null;
  status: number;
  created_at: string;
}

export interface IdempotencyReservation {
  key: string;
}

export interface IdempotencyCompletion {
  key: string;
  actor: string;
  response: Record<string, unknown> | null;
  status: number;
}

export const idempotencyRepository = {
  /**
   * Return the COMPLETED cached entry for (key, actor) if present and within
   * the TTL window. Pending rows are filtered out — callers that race must
   * either poll or be answered with 409 (still in flight).
   */
  findCached(
    key: string,
    actorEmail: string,
    cutoffIso: string
  ): Promise<ApiResult<IdempotencyCachedRow | null>> {
    const db = adminClient();
    return runQuery<IdempotencyCachedRow | null>(
      () =>
        db
          .from(TABLE)
          .select("response, status, created_at")
          .eq("key", key)
          .eq("actor", actorEmail)
          .gte("created_at", cutoffIso)
          .gt("status", PENDING_STATUS)
          .maybeSingle(),
      `${SCOPE}.findCached`
    );
  },

  /**
   * Insert a pending row (`status = 0`, `response = null`) with
   * `ON CONFLICT (key, actor) DO NOTHING`.
   *
   * Returns:
   *   data = { key }  — we inserted the row; we are the first caller and
   *                     own running the handler.
   *   data = null     — conflict; another caller already holds the key.
   */
  tryReservePending(row: {
    key: string;
    actor: string;
    route: string;
  }): Promise<ApiResult<IdempotencyReservation | null>> {
    const db = adminClient();
    return runQuery<IdempotencyReservation | null>(
      async () => {
        const staleBefore = new Date(Date.now() - PENDING_STALE_MS).toISOString();
        await db
          .from(TABLE)
          .delete()
          .eq("status", PENDING_STATUS)
          .is("response", null)
          .lt("created_at", staleBefore);

        const { data, error } = await db
          .from(TABLE)
          .upsert(
            {
              key: row.key,
              actor: row.actor,
              route: row.route,
              response: null,
              status: PENDING_STATUS
            },
            { onConflict: "key,actor", ignoreDuplicates: true }
          )
          .select("key");
        if (error) return { data: null, error };
        const inserted = Array.isArray(data) && data.length > 0 && data[0] ? { key: data[0].key as string } : null;
        return { data: inserted, error: null };
      },
      `${SCOPE}.tryReservePending`
    );
  },

  /**
   * Update the previously-reserved row with the final response/status.
   * Only updates rows currently in PENDING state — protects against a
   * stale write overwriting a completed entry on retry.
   */
  completePending(row: IdempotencyCompletion): Promise<ApiResult<null>> {
    const db = adminClient();
    return runQuery<null>(
      async () => {
        const { error } = await db
          .from(TABLE)
          .update({ response: row.response, status: row.status })
          .eq("key", row.key)
          .eq("actor", row.actor)
          .eq("status", PENDING_STATUS);
        return { data: null, error };
      },
      `${SCOPE}.completePending`
    );
  }
};
