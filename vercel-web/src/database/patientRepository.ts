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
  callRpc,
  resolveClient
} from "@/database/baseRepository";
import { runListQuery } from "@/database/supabaseClient";
import { sanitizeSearchTerm } from "@/lib/api/security";
import { patientNameKey } from "@/business/patientRules";

const TABLE = "hh_patients";
const BILLINGS = "hh_billings";
const RECEIPTS = "hh_receipts";
const SCOPE = "patientRepository";

export interface PatientListFilters extends ListQuery {
  q?: string;
  status?: string;
  gender?: string;
  area?: string;
  pin?: string;
  shift?: string;
  caretaker_id?: string;
  /** Inclusive YYYY-MM-DD created_at bounds (Reports period scoping). */
  created_from?: string;
  created_to?: string;
}

export const patientRepository = {
  findById(id: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return findById(TABLE, id, SCOPE, opts);
  },

  findByIds(ids: string[], opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    if (!ids.length) return Promise.resolve({ success: true, data: [] });
    const unique = Array.from(new Set(ids.filter(Boolean)));
    return listAll(TABLE, SCOPE, (q) => q.in("id", unique), opts);
  },

  list(filters: PatientListFilters = {}, opts?: DbAccess): Promise<ApiResult<ListResult<JsonRow>>> {
    return listRows(
      TABLE,
      SCOPE,
      (q) => {
        let query = q;
        if (filters.status) query = query.eq("status", filters.status);
        if (filters.gender) query = query.eq("gender", filters.gender);
        if (filters.shift) query = query.eq("shift", filters.shift);
        if (filters.area) {
          const area = filters.area.replace(/%/g, "");
          query = query.ilike("area", `%${area}%`);
        }
        if (filters.pin) {
          const pin = filters.pin.replace(/%/g, "");
          query = query.ilike("pin", `%${pin}%`);
        }
        if (filters.caretaker_id) query = query.eq("caretaker_id", filters.caretaker_id);
        if (filters.created_from) query = query.gte("created_at", filters.created_from);
        if (filters.created_to) {
          query = query.lte("created_at", `${filters.created_to}T23:59:59.999Z`);
        }
        if (filters.q) {
          const term = sanitizeSearchTerm(filters.q);
          if (term) {
            query = query.or(
              ["name", "phone", "area", "city", "addr", "relname", "relphone"]
                .map((c) => `${c}.ilike.%${term}%`)
                .join(",")
            );
          }
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

  /**
   * Active patients with a name matching `name` (case-insensitive). Used by
   * the soft-duplicate guard to catch the same-person-different-phone case
   * that the phone-only check misses.
   */
  async findActiveByName(
    name: string,
    excludeId?: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    const key = patientNameKey(name);
    if (!key) return { success: true, data: [] };
    const db = resolveClient(opts);
    const result = await runListQuery<JsonRow>(
      () => {
        let q = db
          .from(TABLE)
          .select("id, name, phone, status, name_key")
          .eq("status", "Active")
          .eq("name_key", key);
        if (excludeId) q = q.neq("id", excludeId);
        return q;
      },
      `${SCOPE}.findActiveByName`
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

  /**
   * Cascading soft-close via `hominal_close_patient` RPC.
   *
   * Returns the cascade summary:
   *   { ok, patient_id, billings_closed, duties_cancelled, duties_truncated }
   *
   * See `supabase/migrations/20260528103500_hominal_close_patient.sql` for
   * the full transactional semantics — this method intentionally just
   * forwards the actor / reason so the SQL is the single source of truth.
   */
  closeCascadeRpc(
    id: string,
    actor: string,
    reason: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow | null>> {
    return callRpc<JsonRow>(
      "hominal_close_patient",
      { p_patient_id: id, p_actor: actor || "", p_reason: reason || "" },
      `${SCOPE}.closeCascadeRpc`,
      opts
    );
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
