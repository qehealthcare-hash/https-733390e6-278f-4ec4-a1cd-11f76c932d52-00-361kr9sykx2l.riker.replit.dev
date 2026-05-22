import type { ApiResult } from "@/types/common";
import type { DbAccess, JsonRow, ListQuery, ListResult } from "@/database/types";
import {
  findById,
  listRows,
  insertRow,
  updateRow,
  deleteRow,
  listAll,
  countWhere,
  resolveClient
} from "@/database/baseRepository";
import { runListQuery } from "@/database/supabaseClient";

const TABLE = "hh_patients";
const BILLINGS = "hh_billings";
const RECEIPTS = "hh_receipts";
const SCOPE = "patientRepository";

export interface PatientListFilters extends ListQuery {
  q?: string;
  status?: string;
  caretaker_id?: string;
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
        if (filters.caretaker_id) query = query.eq("caretaker_id", filters.caretaker_id);
        if (filters.q) {
          const term = filters.q.replace(/%/g, "");
          query = query.or(
            ["name", "phone", "area", "city", "addr", "relname", "relphone"]
              .map((c) => `${c}.ilike.%${term}%`)
              .join(",")
          );
        }
        return query;
      },
      { ...opts, ...filters, orderBy: filters.orderBy ?? "created_at", ascending: filters.ascending ?? false }
    );
  },

  /** Active patients matching phone suffix (duplicate detection). */
  async findActiveByPhoneSuffix(
    phone: string,
    excludeId?: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    const normalized = (phone || "").replace(/[^0-9+]/g, "");
    const suffix = normalized.slice(-8);
    if (!suffix) return { success: true, data: [] };
    const db = resolveClient(opts);
    const result = await runListQuery<JsonRow>(
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

  remove(id: string, opts?: DbAccess): Promise<ApiResult<null>> {
    return deleteRow(TABLE, id, SCOPE, opts);
  },

  countBillings(patientId: string, opts?: DbAccess): Promise<ApiResult<number>> {
    return countWhere(BILLINGS, SCOPE, (q) => q.eq("patient_id", patientId), opts);
  },

  countDuties(patientId: string, opts?: DbAccess): Promise<ApiResult<number>> {
    return countWhere("hh_duties", SCOPE, (q) => q.eq("patient_id", patientId), opts);
  },

  listHistoryBillings(patientId: string, opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    return listAll(BILLINGS, SCOPE, (q) => q.eq("patient_id", patientId), {
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

  /** Receipts for a set of billing IDs (patient history ledger). */
  async listReceiptsForBillings(
    billingIds: string[],
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    if (!billingIds.length) return { success: true, data: [] };
    const db = resolveClient(opts);
    return runListQuery<JsonRow>(
      () =>
        db
          .from(RECEIPTS)
          .select("*")
          .in("billing_id", billingIds)
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
      `${SCOPE}.listReceiptsForBillings`
    );
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
