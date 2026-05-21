import type { ApiResult } from "@/types/common";
import type { DbAccess, JsonRow, ListQuery, ListResult } from "@/database/types";
import {
  findById,
  listRows,
  insertRow,
  updateRow,
  deleteRow,
  listAll,
  resolveClient
} from "@/database/baseRepository";
import { runListQuery } from "@/database/supabaseClient";

const TABLE = "hh_patients";
const SCOPE = "patientRepository";

export interface PatientListFilters extends ListQuery {
  q?: string;
  status?: string;
}

export const patientRepository = {
  findById(id: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return findById(TABLE, id, SCOPE, opts);
  },

  list(filters: PatientListFilters = {}, opts?: DbAccess): Promise<ApiResult<ListResult<JsonRow>>> {
    return listRows(
      TABLE,
      SCOPE,
      (q) => {
        let query = q;
        if (filters.status) query = query.eq("status", filters.status);
        if (filters.q) {
          const term = filters.q.replace(/%/g, "");
          query = query.or(
            ["name", "phone", "area", "city", "addr"].map((c) => `${c}.ilike.%${term}%`).join(",")
          );
        }
        return query;
      },
      { ...opts, ...filters, orderBy: filters.orderBy ?? "created_at", ascending: filters.ascending ?? false }
    );
  },

  /** Normalised phone suffix match for duplicate detection (last 8 digits). */
  async findActiveByPhoneSuffix(
    phone: string,
    excludeId?: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    const normalized = (phone || "").replace(/[^0-9+]/g, "");
    const suffix = normalized.slice(-8);
    if (!suffix) return { success: true, data: [] };
    const db = resolveClient(opts);
    const result = await runListQuery(
      () =>
        db
          .from(TABLE)
          .select("id, name, phone, status")
          .eq("status", "Active")
          .ilike("phone", `%${suffix}%`),
      `${SCOPE}.findActiveByPhoneSuffix`
    );
    if (!result.success) return result;
    const rows = (result.data || []).filter((r) => !excludeId || String(r.id) !== excludeId);
    return { success: true, data: rows };
  },

  insert(row: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return insertRow(TABLE, row, SCOPE, opts);
  },

  update(id: string, patch: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return updateRow(TABLE, id, patch, SCOPE, opts);
  },

  /** Hard delete (legacy CRM uses soft-close via status update in services). */
  remove(id: string, opts?: DbAccess): Promise<ApiResult<null>> {
    return deleteRow(TABLE, id, SCOPE, opts);
  },

  listHistoryBillings(patientId: string, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    return listAll("hh_billings", SCOPE, (q) => q.eq("patient_id", patientId), {
      ...opts,
      orderBy: "created_at",
      ascending: false
    });
  },

  listHistoryDuties(patientId: string, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    return listAll("hh_duties", SCOPE, (q) => q.eq("patient_id", patientId), {
      ...opts,
      orderBy: "start_at",
      ascending: false
    });
  },

  listHistoryAudits(patientId: string, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery(
      () =>
        db
          .from("hh_audit_logs")
          .select("*")
          .eq("module", "patient")
          .eq("entity_id", patientId)
          .order("created_at", { ascending: false })
          .limit(100),
      `${SCOPE}.listHistoryAudits`
    );
  }
};
