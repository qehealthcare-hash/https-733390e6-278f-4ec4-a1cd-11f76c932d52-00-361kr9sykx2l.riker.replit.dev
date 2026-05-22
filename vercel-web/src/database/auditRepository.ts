import type { ApiResult } from "@/types/common";
import type { DbAccess, JsonRow, ListQuery, ListResult } from "@/database/types";
import { insertRow, listRows, resolveClient } from "@/database/baseRepository";
import { runListQuery } from "@/database/supabaseClient";

const TABLE = "hh_audit_logs";
const SCOPE = "auditRepository";

export interface AuditInsertRow {
  module: string;
  entity_id?: string | null;
  action: string;
  actor: string;
  user_id?: string | null;
  stamp?: string;
  before?: unknown;
  after?: unknown;
  payload?: unknown;
}

export interface AuditListFilters extends ListQuery {
  module?: string;
  entity_id?: string;
  action?: string;
}

/** Insert-only audit trail (matches `lib/api/audit.ts` columns). */
export const auditRepository = {
  insert(entry: AuditInsertRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return insertRow(
      TABLE,
      {
        module: entry.module,
        entity_id: entry.entity_id ?? null,
        action: entry.action,
        actor: entry.actor,
        user_id: entry.user_id ?? null,
        stamp: entry.stamp ?? `${entry.action} by ${entry.actor}`,
        before: entry.before ?? null,
        after: entry.after ?? null,
        payload: entry.payload ?? {}
      },
      SCOPE,
      opts
    );
  },

  list(filters: AuditListFilters = {}, opts?: DbAccess): Promise<ApiResult<ListResult<JsonRow>>> {
    return listRows(
      TABLE,
      SCOPE,
      (q) => {
        let query = q;
        if (filters.module) query = query.eq("module", filters.module);
        if (filters.entity_id) query = query.eq("entity_id", filters.entity_id);
        if (filters.action) query = query.eq("action", filters.action);
        return query;
      },
      { ...opts, ...filters, orderBy: filters.orderBy ?? "created_at", ascending: filters.ascending ?? false }
    );
  },

  listByEntity(module: string, entityId: string, limit = 100, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery(
      () =>
        db
          .from(TABLE)
          .select("*")
          .eq("module", module)
          .eq("entity_id", entityId)
          .order("created_at", { ascending: false })
          .limit(limit),
      `${SCOPE}.listByEntity`
    );
  }
};
