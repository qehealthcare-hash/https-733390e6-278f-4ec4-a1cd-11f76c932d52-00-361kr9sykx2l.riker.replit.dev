import { supabaseAdmin } from "../supabase";
import { badRequest, notFound } from "../errors";

const TABLE = "hh_vendors";

const ALLOWED_FIELDS = [
  "name",
  "contact",
  "phone",
  "email",
  "gst",
  "pan",
  "addr",
  "city"
] as const;

type VendorRow = { id: string; name?: string | null; [k: string]: unknown };

function buildPayload(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ALLOWED_FIELDS) {
    if (input[key] !== undefined) {
      out[key] = String(input[key] ?? "").trim();
    }
  }
  return out;
}

function nextVendorId(rows: VendorRow[]): string {
  let max = 0;
  rows.forEach((r) => {
    const m = String(r.id || "").match(/^VEN(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  });
  return "VEN" + String(max + 1).padStart(5, "0");
}

export const vendorService = {
  async list(query: { q?: string; city?: string; limit?: number; offset?: number }) {
    const db = supabaseAdmin();
    const limit = Math.min(Math.max(query.limit || 100, 1), 500);
    const offset = Math.max(query.offset || 0, 0);
    let q = db.from(TABLE).select("*", { count: "exact" }).order("name").range(offset, offset + limit - 1);
    if (query.q) q = q.or(`name.ilike.%${query.q}%,contact.ilike.%${query.q}%,phone.ilike.%${query.q}%,gst.ilike.%${query.q}%`);
    if (query.city) q = q.ilike("city", `%${query.city}%`);
    const { data, error, count } = await q;
    if (error) throw error;
    return { rows: data || [], total: count ?? (data || []).length };
  },

  async get(id: string) {
    const db = supabaseAdmin();
    const { data, error } = await db.from(TABLE).select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) throw notFound("Vendor");
    return data;
  },

  async create(input: Record<string, unknown>) {
    if (!input.name || String(input.name).trim() === "") {
      throw badRequest("Vendor name is required");
    }
    const db = supabaseAdmin();
    const existing = await db.from(TABLE).select("id").order("id", { ascending: false }).limit(500);
    if (existing.error) throw existing.error;
    const row = {
      id: nextVendorId((existing.data || []) as VendorRow[]),
      ...buildPayload(input),
      created: new Date().toISOString().slice(0, 10)
    };
    const { data, error } = await db.from(TABLE).insert(row).select("*").maybeSingle();
    if (error) throw error;
    return data;
  },

  async update(id: string, input: Record<string, unknown>) {
    const payload = buildPayload(input);
    if (Object.keys(payload).length === 0) {
      throw badRequest("No editable fields supplied");
    }
    const db = supabaseAdmin();
    const { data, error } = await db.from(TABLE).update(payload).eq("id", id).select("*").maybeSingle();
    if (error) throw error;
    if (!data) throw notFound("Vendor");
    return data;
  },

  async remove(id: string) {
    const db = supabaseAdmin();
    const { error } = await db.from(TABLE).delete().eq("id", id);
    if (error) throw error;
    return { id, deleted: true };
  }
};
