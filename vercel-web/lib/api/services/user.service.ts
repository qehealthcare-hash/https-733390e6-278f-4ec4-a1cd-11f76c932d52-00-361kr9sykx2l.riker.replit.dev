import { supabaseAdmin } from "../supabase";
import { badRequest, notFound, conflict } from "../errors";

const USERS = "hh_users";
const ROLES = "hh_roles";

type UserRow = {
  id: string;
  username: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  is_active?: boolean | null;
  created?: string | null;
};

const USER_FIELDS = ["username", "email", "phone", "role", "is_active"] as const;

function nextId(rows: { id: string }[], prefix: string, width = 5): string {
  const re = new RegExp("^" + prefix + "(\\d+)$");
  let max = 0;
  rows.forEach((r) => {
    const m = String(r.id || "").match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  });
  return prefix + String(max + 1).padStart(width, "0");
}

function buildPayload(input: Record<string, unknown>): Partial<UserRow> {
  const out: Partial<UserRow> = {};
  for (const k of USER_FIELDS) {
    if (input[k] === undefined) continue;
    if (k === "is_active") {
      out.is_active = Boolean(input[k]);
    } else if (k === "email" || k === "username" || k === "role") {
      const trimmed = String(input[k] ?? "").trim();
      if (k === "email") out.email = trimmed.toLowerCase();
      else out[k] = trimmed;
    } else {
      out[k] = String(input[k] ?? "").trim();
    }
  }
  return out;
}

export const userService = {
  async listUsers(q: { q?: string; role?: string; active?: string; limit?: number; offset?: number }) {
    const db = supabaseAdmin();
    const limit = Math.min(Math.max(q.limit || 200, 1), 500);
    const offset = Math.max(q.offset || 0, 0);
    let query = db.from(USERS).select("*", { count: "exact" }).order("username").range(offset, offset + limit - 1);
    if (q.q) query = query.or(`username.ilike.%${q.q}%,email.ilike.%${q.q}%,phone.ilike.%${q.q}%`);
    if (q.role) query = query.eq("role", q.role);
    if (q.active === "true") query = query.eq("is_active", true);
    if (q.active === "false") query = query.eq("is_active", false);
    const { data, error, count } = await query;
    if (error) throw error;
    return { rows: data || [], total: count ?? (data || []).length };
  },

  async getUser(id: string) {
    const db = supabaseAdmin();
    const { data, error } = await db.from(USERS).select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) throw notFound("User");
    return data;
  },

  async createUser(input: Record<string, unknown>) {
    if (!input.username || String(input.username).trim() === "") {
      throw badRequest("username is required");
    }
    const payload = buildPayload(input);
    if (payload.is_active === undefined) payload.is_active = true;
    const db = supabaseAdmin();

    const existingUsername = await db.from(USERS).select("id").ilike("username", String(input.username)).limit(1);
    if (existingUsername.error) throw existingUsername.error;
    if (existingUsername.data && existingUsername.data.length) {
      throw conflict("username already taken");
    }
    if (payload.email) {
      const existingEmail = await db.from(USERS).select("id").ilike("email", payload.email).limit(1);
      if (existingEmail.error) throw existingEmail.error;
      if (existingEmail.data && existingEmail.data.length) {
        throw conflict("email already used by another user");
      }
    }

    const existing = await db.from(USERS).select("id").order("id", { ascending: false }).limit(500);
    if (existing.error) throw existing.error;
    const row = {
      id: nextId(existing.data || [], "USR"),
      ...payload,
      created: new Date().toISOString().slice(0, 10)
    };
    const { data, error } = await db.from(USERS).insert(row).select("*").maybeSingle();
    if (error) throw error;
    return data;
  },

  async updateUser(id: string, input: Record<string, unknown>) {
    const payload = buildPayload(input);
    if (Object.keys(payload).length === 0) {
      throw badRequest("No editable fields supplied");
    }
    const db = supabaseAdmin();
    const { data, error } = await db.from(USERS).update(payload).eq("id", id).select("*").maybeSingle();
    if (error) throw error;
    if (!data) throw notFound("User");
    return data;
  },

  async deleteUser(id: string) {
    const db = supabaseAdmin();
    const { error } = await db.from(USERS).update({ is_active: false }).eq("id", id);
    if (error) throw error;
    return { id, deactivated: true };
  },

  // ─────────────────────────────────────────────────────────────────────
  // Roles
  // ─────────────────────────────────────────────────────────────────────

  async listRoles() {
    const db = supabaseAdmin();
    const { data, error } = await db.from(ROLES).select("*").order("name");
    if (error) throw error;
    return { rows: data || [], total: (data || []).length };
  },

  async getRole(id: string) {
    const db = supabaseAdmin();
    const { data, error } = await db.from(ROLES).select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) throw notFound("Role");
    return data;
  },

  async createRole(input: Record<string, unknown>) {
    if (!input.name || String(input.name).trim() === "") {
      throw badRequest("Role name is required");
    }
    const db = supabaseAdmin();
    const existing = await db.from(ROLES).select("id, name").order("id", { ascending: false }).limit(500);
    if (existing.error) throw existing.error;
    if ((existing.data || []).some((r) => String(r.name).toLowerCase() === String(input.name).toLowerCase())) {
      throw conflict("Role name already exists");
    }
    const row = {
      id: nextId(existing.data || [], "ROL"),
      name: String(input.name).trim(),
      perms: input.perms && typeof input.perms === "object" ? input.perms : {}
    };
    const { data, error } = await db.from(ROLES).insert(row).select("*").maybeSingle();
    if (error) throw error;
    return data;
  },

  async updateRole(id: string, input: Record<string, unknown>) {
    const payload: Record<string, unknown> = {};
    if (input.name !== undefined) payload.name = String(input.name).trim();
    if (input.perms !== undefined) {
      payload.perms = input.perms && typeof input.perms === "object" ? input.perms : {};
    }
    if (Object.keys(payload).length === 0) {
      throw badRequest("No editable fields supplied");
    }
    const db = supabaseAdmin();
    const { data, error } = await db.from(ROLES).update(payload).eq("id", id).select("*").maybeSingle();
    if (error) throw error;
    if (!data) throw notFound("Role");
    return data;
  },

  async deleteRole(id: string) {
    const db = supabaseAdmin();
    const inUse = await db.from(USERS).select("id").eq("role", id).limit(1);
    if (inUse.error) throw inUse.error;
    if (inUse.data && inUse.data.length) {
      throw conflict("Role is assigned to users; reassign first");
    }
    const { error } = await db.from(ROLES).delete().eq("id", id);
    if (error) throw error;
    return { id, deleted: true };
  }
};
