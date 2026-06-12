import type { ApiResult } from "@/types/common";
import type { DbAccess, JsonRow, ListQuery, ListResult } from "@/database/types";
import {
  findById,
  listRows,
  insertRow,
  updateRow,
  deleteRow,
  countWhere,
  callRpc,
  resolveClient
} from "@/database/baseRepository";
import { runListQuery, runQuery } from "@/database/supabaseClient";
import { sanitizeSearchTerm } from "@/utils/searchTerm";

const TABLE = "hh_inquiries";
const PATIENTS = "hh_patients";
const SCOPE = "inquiryRepository";

export interface InquiryListFilters extends ListQuery {
  q?: string;
  status?: string;
  assigned_to?: string;
  source?: string;
  open_only?: boolean;
  followup_from?: string;
  followup_to?: string;
  /** Inclusive YYYY-MM-DD created_at bounds (Reports period scoping). */
  created_from?: string;
  created_to?: string;
}

export const inquiryRepository = {
  findById(id: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return findById(TABLE, id, SCOPE, opts);
  },

  list(filters: InquiryListFilters = {}, opts?: DbAccess): Promise<ApiResult<ListResult<JsonRow>>> {
    return listRows(
      TABLE,
      SCOPE,
      (q) => {
        let query = q;
        if (filters.status) query = query.eq("status", filters.status);
        if (filters.assigned_to) query = query.eq("assigned_to", filters.assigned_to);
        if (filters.source) query = query.eq("source", filters.source);
        if (filters.open_only) {
          query = query.not("status", "in", "(Converted,Closed,Lost)");
        }
        if (filters.followup_from) query = query.gte("followup_date", filters.followup_from);
        if (filters.followup_to) query = query.lte("followup_date", filters.followup_to);
        if (filters.created_from) query = query.gte("created_at", filters.created_from);
        if (filters.created_to) {
          // Inclusive end-of-day so `to=2026-05-31` includes that day's rows.
          query = query.lte("created_at", `${filters.created_to}T23:59:59.999Z`);
        }
        if (filters.q) {
          const term = sanitizeSearchTerm(filters.q);
          if (term) {
            query = query.or(
              ["name", "phone", "city", "area", "service", "source", "assigned_to"]
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

  /**
   * Find an *open* inquiry (status NOT in Converted/Closed/Lost) matching a
   * phone number. Used for duplicate detection and matches the DB unique
   * index `uq_hh_inquiries_active_phone`.
   */
  async findActiveByPhone(
    phone: string,
    excludeId?: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow[]>> {
    const normalized = (phone || "").replace(/[^0-9+]/g, "");
    if (!normalized) return { success: true, data: [] };
    const suffix = normalized.slice(-8);
    const db = resolveClient(opts);
    const result = await runListQuery<JsonRow>(
      () =>
        db
          .from(TABLE)
          .select("id, name, phone, status, followup_date, assigned_to")
          .not("status", "in", "(Converted,Closed,Lost)")
          .ilike("phone", `%${suffix}%`),
      `${SCOPE}.findActiveByPhone`
    );
    if (!result.success) return result;
    const rows = (result.data || []).filter((r) => !excludeId || String(r.id) !== excludeId);
    return { success: true, data: rows };
  },

  /** Exact-phone lookup retained for legacy callers. */
  async findByPhone(
    phone: string,
    excludeId?: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow | null>> {
    const normalized = (phone || "").replace(/[^0-9+]/g, "");
    if (!normalized) return { success: true, data: null };
    const db = resolveClient(opts);
    return runQuery(async () => {
      const { data, error } = await db
        .from(TABLE)
        .select("id, name, phone, status")
        .eq("phone", normalized)
        .maybeSingle();
      if (error) return { data: null, error };
      if (data && excludeId && String(data.id) === excludeId) return { data: null, error: null };
      return { data, error: null };
    }, `${SCOPE}.findByPhone`);
  },

  /**
   * Look up the existing patient (if any) by exact phone. Used by the convert
   * flow so we attach the inquiry to the existing record instead of creating
   * a duplicate patient.
   */
  async findPatientByPhone(
    phone: string,
    opts?: DbAccess
  ): Promise<ApiResult<JsonRow | null>> {
    const normalized = (phone || "").replace(/[^0-9+]/g, "");
    if (!normalized) return { success: true, data: null };
    const suffix = normalized.slice(-8);
    const db = resolveClient(opts);
    return runQuery(
      () =>
        db
          .from(PATIENTS)
          .select("id, name, phone, status")
          .ilike("phone", `%${suffix}%`)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      `${SCOPE}.findPatientByPhone`
    );
  },

  countByStatus(status: string, opts?: DbAccess): Promise<ApiResult<number>> {
    return countWhere(TABLE, SCOPE, (q) => q.eq("status", status), opts);
  },

  countAll(opts?: DbAccess): Promise<ApiResult<number>> {
    return countWhere(TABLE, SCOPE, (q) => q, opts);
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
   * Server-side convert via the existing `hh_convert_inquiry_to_patient` RPC.
   * Returns `{ patient_id, inquiry_id }`. The RPC is idempotent — re-running
   * it for a converted inquiry returns the same patient_id.
   */
  convertRpc(
    inquiryId: string,
    opts?: DbAccess
  ): Promise<
    ApiResult<{ patient_id?: string; inquiry_id?: string; already_converted?: boolean } | null>
  > {
    return callRpc<{ patient_id?: string; inquiry_id?: string; already_converted?: boolean }>(
      "hh_convert_inquiry_to_patient",
      { p_inquiry_id: inquiryId },
      SCOPE,
      opts
    );
  }
};
