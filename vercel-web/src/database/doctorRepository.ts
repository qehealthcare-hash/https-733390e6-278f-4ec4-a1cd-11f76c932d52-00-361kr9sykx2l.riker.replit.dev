/**
 * Doctor repository — Supabase access for `hh_doctors`.
 *
 * Returns ApiResult<T> from every method. Composes the shared baseRepository
 * primitives so all PostgREST error handling is consistent across the app.
 */

import type { ApiResult } from "@/types/common";
import type { DbAccess, JsonRow, ListResult } from "@/database/types";
import {
  deleteRow,
  findById as baseFindById,
  insertRow,
  listRows,
  resolveClient,
  updateRow
} from "@/database/baseRepository";
import { runListQuery } from "@/database/supabaseClient";
import { sanitizeSearchTerm } from "@/lib/api/security";

const TABLE = "hh_doctors";

export interface DoctorListQuery extends DbAccess {
  q?: string;
  city?: string;
  spec?: string;
  limit?: number;
  offset?: number;
}

export const doctorRepository = {
  list(opts: DoctorListQuery): Promise<ApiResult<ListResult<JsonRow>>> {
    return listRows(
      TABLE,
      "doctor",
      (q) => {
        let chain = q;
        if (opts.q) {
          const term = sanitizeSearchTerm(opts.q);
          if (term) {
            chain = chain.or(
              `fn.ilike.%${term}%,ln.ilike.%${term}%,phone.ilike.%${term}%,clinic.ilike.%${term}%`
            );
          }
        }
        if (opts.city) chain = chain.ilike("city", `%${sanitizeSearchTerm(opts.city)}%`);
        if (opts.spec) chain = chain.ilike("spec", `%${sanitizeSearchTerm(opts.spec)}%`);
        return chain;
      },
      {
        accessToken: opts.accessToken,
        limit: opts.limit ?? 100,
        offset: opts.offset ?? 0,
        orderBy: "fn",
        ascending: true
      }
    );
  },

  findById(id: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return baseFindById(TABLE, id, "doctor", opts);
  },

  /** Returns the most-recently-id'd 500 rows so the service can compute the next sequence. */
  async listForSequence(opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery(
      () => db.from(TABLE).select("id").order("id", { ascending: false }).limit(500),
      "doctor.listForSequence"
    );
  },

  insert(row: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return insertRow(TABLE, row, "doctor", opts);
  },

  update(id: string, patch: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return updateRow(TABLE, id, patch, "doctor", opts);
  },

  remove(id: string, opts?: DbAccess): Promise<ApiResult<null>> {
    return deleteRow(TABLE, id, "doctor", opts);
  }
};
