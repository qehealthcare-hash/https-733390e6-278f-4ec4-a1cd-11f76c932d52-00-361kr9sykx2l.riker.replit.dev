/** Parse `hh_roles.perms` JSON/text into a flat permission string list. */
export function parseRolePerms(raw: unknown): string[] {
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
    return parseRolePerms(maybe.permissions ?? maybe.perms);
  }
  return [];
}
