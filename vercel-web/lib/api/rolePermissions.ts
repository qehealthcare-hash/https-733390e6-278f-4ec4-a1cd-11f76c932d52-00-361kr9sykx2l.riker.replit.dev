import { roleRepository } from "@/database/userRepository";
import type { AppRole } from "@/lib/api/auth";

/** Load permission strings for a CRM role label from `hh_roles.perms`. */
export async function loadRolePermissions(role: AppRole): Promise<string[]> {
  const label = String(role || "").trim();
  if (!label) return [];

  const result = await roleRepository.listPermissionsForRoleName(label);
  if (!result.success) return [];
  return result.data || [];
}
