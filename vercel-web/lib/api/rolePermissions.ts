import { supabaseAdmin } from "@/lib/api/supabase";
import type { AppRole } from "@/lib/api/auth";

function parsePerms(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((p) => String(p || "").trim()).filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((p) => String(p || "").trim()).filter(Boolean);
      }
    } catch {
      return raw
        .split(/[,\n]/)
        .map((p) => p.trim())
        .filter(Boolean);
    }
  }
  if (raw && typeof raw === "object") {
    const maybe = raw as { permissions?: unknown; perms?: unknown };
    return parsePerms(maybe.permissions ?? maybe.perms);
  }
  return [];
}

/** Load permission strings for a CRM role label from `hh_roles.perms`. */
export async function loadRolePermissions(role: AppRole): Promise<string[]> {
  const label = String(role || "").trim();
  if (!label) return [];

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("hh_roles")
    .select("perms")
    .ilike("name", label)
    .maybeSingle();

  if (error || !data) return [];
  return parsePerms(data.perms);
}
