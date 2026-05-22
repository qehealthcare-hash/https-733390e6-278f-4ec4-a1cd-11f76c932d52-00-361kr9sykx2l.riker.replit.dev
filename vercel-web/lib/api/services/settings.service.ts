import { supabaseAdmin } from "../supabase";
import { badRequest } from "../errors";

const TABLE = "hh_app_settings";

export const settingsService = {
  async listAll() {
    const db = supabaseAdmin();
    const { data, error } = await db.from(TABLE).select("key, value");
    if (error) throw error;
    const map: Record<string, unknown> = {};
    (data || []).forEach((row: { key: string; value: unknown }) => {
      map[row.key] = row.value;
    });
    return map;
  },

  async getKey(key: string) {
    if (!key) throw badRequest("key is required");
    const db = supabaseAdmin();
    const { data, error } = await db.from(TABLE).select("value").eq("key", key).maybeSingle();
    if (error) throw error;
    return data?.value ?? null;
  },

  async setKey(key: string, value: unknown) {
    if (!key) throw badRequest("key is required");
    const db = supabaseAdmin();
    const { data, error } = await db
      .from(TABLE)
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" })
      .select("key, value")
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async deleteKey(key: string) {
    if (!key) throw badRequest("key is required");
    const db = supabaseAdmin();
    const { error } = await db.from(TABLE).delete().eq("key", key);
    if (error) throw error;
    return { key, deleted: true };
  },

  async bulkSet(items: Record<string, unknown>) {
    if (!items || typeof items !== "object") {
      throw badRequest("Body must be an object of key→value pairs");
    }
    const db = supabaseAdmin();
    const rows = Object.keys(items).map((key) => ({
      key,
      value: items[key],
      updated_at: new Date().toISOString()
    }));
    if (!rows.length) return [];
    const { data, error } = await db.from(TABLE).upsert(rows, { onConflict: "key" }).select("key, value");
    if (error) throw error;
    return data || [];
  }
};
