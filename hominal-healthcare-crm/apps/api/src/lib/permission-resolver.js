import { supabaseAdmin } from "./supabase.js";
import { getStaticPermissionCodesForRole } from "./permissions.js";

/** Short TTL cache: grants rarely change; reduces DB reads per request burst. */
var cacheByRole = new Map();
var CACHE_MS = 60 * 1000;

function cacheGet(roleKey) {
  var row = cacheByRole.get(roleKey);
  if (!row) return null;
  if (Date.now() - row.at > CACHE_MS) {
    cacheByRole.delete(roleKey);
    return null;
  }
  return row.codes;
}

function cacheSet(roleKey, codes) {
  cacheByRole.set(roleKey, { at: Date.now(), codes: codes });
}

/**
 * Single source of truth: `crm_role_permission_grants` (migration 008).
 * Falls back to static map if table missing or empty (bootstrap / old DB).
 */
export async function resolvePermissionCodesForRole(role) {
  var roleKey = String(role || "").toUpperCase();
  if (!roleKey) return [];

  var cached = cacheGet(roleKey);
  if (cached) return cached;

  var fallback = getStaticPermissionCodesForRole(roleKey);

  try {
    var result = await supabaseAdmin
      .from("crm_role_permission_grants")
      .select("permission_code")
      .eq("role", roleKey);

    if (result.error) {
      cacheSet(roleKey, fallback);
      return fallback;
    }

    var rows = result.data || [];
    if (!rows.length) {
      cacheSet(roleKey, fallback);
      return fallback;
    }

    var codes = rows.map(function (r) {
      return r.permission_code;
    });
    if (codes.indexOf("*") !== -1) {
      cacheSet(roleKey, ["*"]);
      return ["*"];
    }

    cacheSet(roleKey, codes);
    return codes;
  } catch (e) {
    cacheSet(roleKey, fallback);
    return fallback;
  }
}

/** Call after admin updates role grants (future admin UI). */
export function invalidatePermissionCache(role) {
  if (role == null) {
    cacheByRole.clear();
    return;
  }
  cacheByRole.delete(String(role).toUpperCase());
}
