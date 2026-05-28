import type { ApiResult } from "@/types/common";
import { adminClient } from "@/database/clients";
import { runQuery } from "@/database/supabaseClient";

const TABLE = "hh_idempotency";
const SCOPE = "idempotencyRepository";

export interface IdempotencyCachedRow {
  response: Record<string, unknown> | null;
  status: number;
  created_at: string;
}

export interface IdempotencyUpsertRow {
  key: string;
  actor: string;
  route: string;
  response: Record<string, unknown> | null;
  status: number;
}

export const idempotencyRepository = {
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
          .maybeSingle(),
      `${SCOPE}.findCached`
    );
  },

  upsert(row: IdempotencyUpsertRow): Promise<ApiResult<null>> {
    const db = adminClient();
    return runQuery<null>(
      async () => {
        const { error } = await db.from(TABLE).upsert(
          {
            key: row.key,
            actor: row.actor,
            route: row.route,
            response: row.response,
            status: row.status
          },
          { onConflict: "key,actor" }
        );
        return { data: null, error };
      },
      `${SCOPE}.upsert`
    );
  }
};
