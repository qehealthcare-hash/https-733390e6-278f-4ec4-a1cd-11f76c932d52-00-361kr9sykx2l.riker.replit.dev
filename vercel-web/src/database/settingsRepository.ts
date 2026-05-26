/**
 * Settings repository — Supabase access for `hh_app_settings`.
 *
 * Key-value store. Each method returns ApiResult<T>; the service layer
 * handles validation and serialization of the value column.
 */

import type { ApiResult } from "@/types/common";
import type { DbAccess, JsonRow } from "@/database/types";
import {
  deleteRow as baseDelete,
  resolveClient,
  upsertRow
} from "@/database/baseRepository";
import { runListQuery, runQuery } from "@/database/supabaseClient";

const TABLE = "hh_app_settings";

interface SettingsRow {
  key: string;
  value: unknown;
  updated_at?: string;
}

export const settingsRepository = {
  async listAll(opts?: DbAccess): Promise<ApiResult<SettingsRow[]>> {
    const db = resolveClient(opts);
    return runListQuery(
      () => db.from(TABLE).select("key, value, updated_at"),
      "settings.listAll"
    );
  },

  async findByKey(
    key: string,
    opts?: DbAccess
  ): Promise<ApiResult<SettingsRow | null>> {
    const db = resolveClient(opts);
    return runQuery(
      () => db.from(TABLE).select("key, value, updated_at").eq("key", key).maybeSingle(),
      "settings.findByKey"
    );
  },

  upsert(row: SettingsRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return upsertRow(TABLE, { ...row }, "settings", opts, "key");
  },

  async upsertMany(rows: SettingsRow[], opts?: DbAccess): Promise<ApiResult<SettingsRow[]>> {
    if (!rows.length) return { success: true, data: [] };
    const db = resolveClient(opts);
    return runListQuery(
      () => db.from(TABLE).upsert(rows, { onConflict: "key" }).select("key, value, updated_at"),
      "settings.upsertMany"
    );
  },

  remove(key: string, opts?: DbAccess): Promise<ApiResult<null>> {
    // baseDelete takes id column = "id"; key-store deletes by `key`.
    const db = resolveClient(opts);
    return runQuery(async () => {
      const { error } = await db.from(TABLE).delete().eq("key", key);
      return { data: null, error };
    }, "settings.delete") as Promise<ApiResult<null>>;
  }
};

// Silence unused-import warning in some configs (baseDelete kept for parity).
void baseDelete;
