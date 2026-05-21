import { supabaseAdmin } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";

export function createBaseService(table) {
  return {
    async list(queryBuilder) {
      let query = supabaseAdmin.from(table).select("*");
      if (queryBuilder) query = queryBuilder(query);
      const result = await query;
      if (result.error) throw new HttpError(500, result.error.message);
      return result.data || [];
    },
    async getById(id, idColumn) {
      const result = await supabaseAdmin
        .from(table)
        .select("*")
        .eq(idColumn || "id", id)
        .single();
      if (result.error) throw new HttpError(result.status || 500, result.error.message);
      return result.data;
    },
    async insert(payload) {
      const result = await supabaseAdmin.from(table).insert(payload).select().single();
      if (result.error) throw new HttpError(500, result.error.message);
      return result.data;
    },
    async update(id, payload, idColumn) {
      const result = await supabaseAdmin
        .from(table)
        .update(payload)
        .eq(idColumn || "id", id)
        .select()
        .single();
      if (result.error) throw new HttpError(500, result.error.message);
      return result.data;
    },
    async remove(id, idColumn) {
      const result = await supabaseAdmin.from(table).delete().eq(idColumn || "id", id);
      if (result.error) throw new HttpError(500, result.error.message);
      return true;
    }
  };
}
