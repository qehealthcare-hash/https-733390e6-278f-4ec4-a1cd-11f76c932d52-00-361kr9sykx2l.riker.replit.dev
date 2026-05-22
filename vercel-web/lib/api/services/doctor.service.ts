import { supabaseAdmin } from "../supabase";
import { badRequest, notFound } from "../errors";

const TABLE = "hh_doctors";

const ALLOWED_FIELDS = [
  "fn",
  "ln",
  "gender",
  "phone",
  "email",
  "city",
  "aadhar",
  "pan",
  "spec",
  "qual",
  "regno",
  "regcouncil",
  "regyear",
  "clinic",
  "clinicaddr"
] as const;

type DoctorRow = {
  id: string;
  fn?: string | null;
  ln?: string | null;
  [key: string]: unknown;
};

function buildPayload(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ALLOWED_FIELDS) {
    if (input[key] !== undefined) {
      out[key] = String(input[key] ?? "").trim();
    }
  }
  return out;
}

function fullName(row: DoctorRow): string {
  return [row.fn, row.ln].filter(Boolean).join(" ").trim();
}

function nextDoctorId(rows: DoctorRow[]): string {
  let max = 0;
  rows.forEach((r) => {
    const m = String(r.id || "").match(/^DOC(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  });
  return "DOC" + String(max + 1).padStart(5, "0");
}

export const doctorService = {
  async list(query: { q?: string; city?: string; spec?: string; limit?: number; offset?: number }) {
    const db = supabaseAdmin();
    const limit = Math.min(Math.max(query.limit || 100, 1), 500);
    const offset = Math.max(query.offset || 0, 0);
    let q = db.from(TABLE).select("*", { count: "exact" }).order("fn").range(offset, offset + limit - 1);
    if (query.q) q = q.or(`fn.ilike.%${query.q}%,ln.ilike.%${query.q}%,phone.ilike.%${query.q}%,clinic.ilike.%${query.q}%`);
    if (query.city) q = q.ilike("city", `%${query.city}%`);
    if (query.spec) q = q.ilike("spec", `%${query.spec}%`);
    const { data, error, count } = await q;
    if (error) throw error;
    const rows = (data || []).map((r) => ({ ...r, full_name: fullName(r) }));
    return { rows, total: count ?? rows.length };
  },

  async get(id: string) {
    const db = supabaseAdmin();
    const { data, error } = await db.from(TABLE).select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) throw notFound("Doctor");
    return { ...data, full_name: fullName(data) };
  },

  async create(input: Record<string, unknown>) {
    if (!input.fn || String(input.fn).trim() === "") {
      throw badRequest("First name (fn) is required");
    }
    if (!input.phone || String(input.phone).trim() === "") {
      throw badRequest("Phone is required");
    }
    const db = supabaseAdmin();
    const existing = await db.from(TABLE).select("id").order("id", { ascending: false }).limit(500);
    if (existing.error) throw existing.error;
    const row = {
      id: nextDoctorId((existing.data || []) as DoctorRow[]),
      ...buildPayload(input),
      created: new Date().toISOString().slice(0, 10)
    };
    const { data, error } = await db.from(TABLE).insert(row).select("*").maybeSingle();
    if (error) throw error;
    return { ...data, full_name: fullName(data!) };
  },

  async update(id: string, input: Record<string, unknown>) {
    const payload = buildPayload(input);
    if (Object.keys(payload).length === 0) {
      throw badRequest("No editable fields supplied");
    }
    const db = supabaseAdmin();
    const { data, error } = await db.from(TABLE).update(payload).eq("id", id).select("*").maybeSingle();
    if (error) throw error;
    if (!data) throw notFound("Doctor");
    return { ...data, full_name: fullName(data) };
  },

  async remove(id: string) {
    const db = supabaseAdmin();
    const { error } = await db.from(TABLE).delete().eq("id", id);
    if (error) throw error;
    return { id, deleted: true };
  }
};
