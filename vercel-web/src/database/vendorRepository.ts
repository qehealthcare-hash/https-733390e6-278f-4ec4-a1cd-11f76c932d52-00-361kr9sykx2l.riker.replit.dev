/**
 * Vendor repository — Supabase access for `hh_vendors`.
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
import { sanitizeSearchTerm } from "@/utils/searchTerm";

const TABLE = "hh_vendors";

export interface VendorListQuery extends DbAccess {
  q?: string;
  city?: string;
  limit?: number;
  offset?: number;
}

export const vendorRepository = {
  list(opts: VendorListQuery): Promise<ApiResult<ListResult<JsonRow>>> {
    return listRows(
      TABLE,
      "vendor",
      (q) => {
        let chain = q;
        if (opts.q) {
          const term = sanitizeSearchTerm(opts.q);
          if (term) {
            chain = chain.or(
              `name.ilike.%${term}%,contact.ilike.%${term}%,phone.ilike.%${term}%,gst.ilike.%${term}%`
            );
          }
        }
        if (opts.city) chain = chain.ilike("city", `%${sanitizeSearchTerm(opts.city)}%`);
        return chain;
      },
      {
        accessToken: opts.accessToken,
        limit: opts.limit ?? 100,
        offset: opts.offset ?? 0,
        orderBy: "name",
        ascending: true
      }
    );
  },

  findById(id: string, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return baseFindById(TABLE, id, "vendor", opts);
  },

  async listForSequence(opts?: DbAccess): Promise<ApiResult<JsonRow[]>> {
    const db = resolveClient(opts);
    return runListQuery(
      () => db.from(TABLE).select("id").order("id", { ascending: false }).limit(500),
      "vendor.listForSequence"
    );
  },

  insert(row: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return insertRow(TABLE, row, "vendor", opts);
  },

  update(id: string, patch: JsonRow, opts?: DbAccess): Promise<ApiResult<JsonRow | null>> {
    return updateRow(TABLE, id, patch, "vendor", opts);
  },

  remove(id: string, opts?: DbAccess): Promise<ApiResult<null>> {
    return deleteRow(TABLE, id, "vendor", opts);
  }
};
