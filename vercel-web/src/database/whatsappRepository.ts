/**
 * WhatsApp repository — `hh_whatsapp_messages` storage.
 *
 * All writes go through the admin client because webhook callbacks run
 * unauthenticated and outbound sends are server-side anyway.
 */

import type { ApiResult } from "@/types/common";
import type { DbAccess, JsonRow, ListResult } from "@/database/types";
import {
  insertRow,
  listRows,
  resolveClient,
  updateRow as baseUpdate
} from "@/database/baseRepository";
import { runQuery } from "@/database/supabaseClient";

const TABLE = "hh_whatsapp_messages";

export interface WhatsappListQuery extends DbAccess {
  limit?: number;
  offset?: number;
  relatedModule?: string;
  relatedId?: string;
}

export interface WhatsappMessageRow {
  id: string;
  direction: "IN" | "OUT";
  to_number?: string;
  from_number?: string;
  related_module?: string;
  related_id?: string;
  payload?: unknown;
  status?: string;
  created_by?: string;
  template?: string;
  provider_message_id?: string;
  sent_at?: string;
  error?: string;
}

export const whatsappRepository = {
  list(opts: WhatsappListQuery): Promise<ApiResult<ListResult<JsonRow>>> {
    return listRows(
      TABLE,
      "whatsapp",
      (q) => {
        let chain = q;
        if (opts.relatedModule) chain = chain.eq("related_module", opts.relatedModule);
        if (opts.relatedId) chain = chain.eq("related_id", opts.relatedId);
        return chain;
      },
      {
        accessToken: opts.accessToken,
        limit: opts.limit ?? 50,
        offset: opts.offset ?? 0,
        orderBy: "created_at",
        ascending: false
      }
    );
  },

  insert(row: WhatsappMessageRow): Promise<ApiResult<JsonRow | null>> {
    return insertRow(TABLE, row as unknown as JsonRow, "whatsapp.insert");
  },

  update(id: string, patch: Partial<WhatsappMessageRow>): Promise<ApiResult<JsonRow | null>> {
    return baseUpdate(TABLE, id, patch as JsonRow, "whatsapp.update");
  },

  /** Update by provider message id (used by Meta status webhooks). */
  async updateByProviderId(
    providerMessageId: string,
    patch: Partial<WhatsappMessageRow>
  ): Promise<ApiResult<JsonRow | null>> {
    const db = resolveClient();
    return runQuery(
      () =>
        db
          .from(TABLE)
          .update(patch)
          .eq("provider_message_id", providerMessageId)
          .select("*")
          .maybeSingle(),
      "whatsapp.updateByProviderId"
    );
  }
};
