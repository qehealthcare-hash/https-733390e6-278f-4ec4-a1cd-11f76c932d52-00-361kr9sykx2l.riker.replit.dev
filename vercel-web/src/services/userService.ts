/**
 * User + role service — orchestrates validation + persistence for
 * `hh_users` and `hh_roles`.
 *
 * Writes always use the admin client (passed via `{ accessToken: undefined }`)
 * because account management is performed by Admin/Manager actors and the
 * underlying tables don't have user-scoped RLS write policies.
 */

import type { ApiResult } from "@/types/common";
import { ErrorCodes } from "@/types/common";
import type { ServiceContext } from "@/types/serviceActor";
import {
  duplicateFailure,
  failure,
  notFoundFailure,
  passFailure,
  success,
  validationFailure
} from "@/utils/apiResponse";
import type { JsonRow, ListResult } from "@/database/types";
import {
  roleRepository,
  userRepository,
  type UserListQuery
} from "@/database/userRepository";
import {
  roleCreateSchema,
  rolePatchSchema,
  userCreateSchema,
  userPatchSchema,
  type UserCreateInput,
  type UserPatchInput
} from "@/validation/userValidation";
import { finalizeWithAudit, writeMutationAudit } from "@/services/mutationAudit";
import { crmTodayIso } from "@/utils/crmToday";

const USER_FIELDS = ["username", "email", "phone", "role", "is_active"] as const;

function nextSequenceId(rows: { id: string }[], prefix: string, width = 5): string {
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

function buildUserPayload(
  input: UserCreateInput | UserPatchInput | Record<string, unknown>
): Record<string, unknown> {
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of USER_FIELDS) {
    if (src[key] === undefined) continue;
    if (key === "is_active") {
      out.is_active = Boolean(src[key]);
    } else if (key === "email") {
      out.email = String(src[key] ?? "").trim().toLowerCase();
    } else {
      out[key] = String(src[key] ?? "").trim();
    }
  }
  return out;
}

export const userService = {
  async listUsers(
    opts: Omit<UserListQuery, "accessToken">,
    ctx: ServiceContext
  ): Promise<ApiResult<ListResult<JsonRow>>> {
    const result = await userRepository.list({ ...opts, accessToken: ctx.accessToken });
    if (!result.success) return passFailure(result);
    const data = result.data;
    return success(data ? { rows: data.rows, total: data.total } : { rows: [], total: 0 });
  },

  async getUser(id: string, ctx: ServiceContext): Promise<ApiResult<JsonRow>> {
    const result = await userRepository.findById(id, { accessToken: ctx.accessToken });
    if (!result.success) return passFailure(result);
    if (!result.data) return notFoundFailure("User", id);
    return success(result.data);
  },

  async createUser(input: unknown, ctx: ServiceContext): Promise<ApiResult<JsonRow>> {
    const parsed = userCreateSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error.flatten());
    const payload = buildUserPayload(parsed.data);
    if (payload.is_active === undefined) payload.is_active = true;

    // P1-22: Only an Admin can mint another Admin. A Manager creating a user
    // with role="Admin" is a privilege-escalation primitive — the audit
    // showed it lets a phished Manager account self-promote by minting a
    // second seat. Refuse the elevation explicitly at the service layer so
    // the API handler does not have to reason about role grids.
    if (
      ctx.actor.role !== "Admin" &&
      typeof payload.role === "string" &&
      payload.role === "Admin"
    ) {
      return failure(
        "Only an Admin can create another Admin user",
        ErrorCodes.forbidden
      );
    }

    const existingUsername = await userRepository.findByUsername(
      String(parsed.data.username)
    );
    if (!existingUsername.success) return passFailure(existingUsername);
    if (existingUsername.data) {
      return duplicateFailure("username", parsed.data.username, "username already taken");
    }

    if (payload.email) {
      const existingEmail = await userRepository.findByEmail(String(payload.email));
      if (!existingEmail.success) return passFailure(existingEmail);
      if (existingEmail.data) {
        return duplicateFailure("email", payload.email, "email already used by another user");
      }
    }

    const seq = await userRepository.listForSequence();
    if (!seq.success) return passFailure(seq);

    const row = {
      id: nextSequenceId((seq.data as { id: string }[]) || [], "USR"),
      ...payload,
      created: crmTodayIso()
    };

    const inserted = await userRepository.insert(row);
    if (!inserted.success) return passFailure(inserted);
    if (!inserted.data) return failure("Failed to create user", ErrorCodes.internal);
    const audit = await writeMutationAudit(undefined, ctx.actor, {
      module: "users",
      entity_id: String(inserted.data.id ?? row.id),
      action: "create",
      after: inserted.data,
      stamp: `Created user ${row.id}`
    });
    return finalizeWithAudit(audit, inserted.data);
  },

  async updateUser(
    id: string,
    input: unknown,
    ctx: ServiceContext
  ): Promise<ApiResult<JsonRow>> {
    const parsed = userPatchSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error.flatten());
    const payload = buildUserPayload(parsed.data);
    if (Object.keys(payload).length === 0) {
      return failure("No editable fields supplied", ErrorCodes.badRequest);
    }
    // P1-22: A Manager cannot promote any user (including themselves) to
    // role="Admin". Same primitive as createUser above, just via patch.
    if (
      ctx.actor.role !== "Admin" &&
      typeof payload.role === "string" &&
      payload.role === "Admin"
    ) {
      return failure(
        "Only an Admin can elevate a user to Admin",
        ErrorCodes.forbidden
      );
    }
    const before = await userRepository.findById(id);
    const updated = await userRepository.update(id, payload);
    if (!updated.success) return passFailure(updated);
    if (!updated.data) return notFoundFailure("User", id);
    const audit = await writeMutationAudit(undefined, ctx.actor, {
      module: "users",
      entity_id: id,
      action: "update",
      before: before.success ? before.data ?? null : null,
      after: updated.data,
      stamp: `Updated user ${id}`
    });
    return finalizeWithAudit(audit, updated.data);
  },

  async deactivateUser(
    id: string,
    ctx: ServiceContext
  ): Promise<ApiResult<{ id: string; deactivated: true }>> {
    const before = await userRepository.findById(id);
    const updated = await userRepository.update(id, { is_active: false });
    if (!updated.success) return passFailure(updated);
    if (!updated.data) return notFoundFailure("User", id);
    const audit = await writeMutationAudit(undefined, ctx.actor, {
      module: "users",
      entity_id: id,
      action: "deactivate",
      before: before.success ? before.data ?? null : null,
      after: updated.data,
      stamp: `Deactivated user ${id}`
    });
    return finalizeWithAudit(audit, { id, deactivated: true as const });
  },

  /* --------------------------------- Roles -------------------------------- */

  async listRoles(
    ctx: ServiceContext
  ): Promise<ApiResult<{ rows: JsonRow[]; total: number }>> {
    const result = await roleRepository.listAll({ accessToken: ctx.accessToken });
    if (!result.success) return passFailure(result);
    const rows = result.data ?? [];
    return success({ rows, total: rows.length });
  },

  async getRole(id: string, ctx: ServiceContext): Promise<ApiResult<JsonRow>> {
    const result = await roleRepository.findById(id, { accessToken: ctx.accessToken });
    if (!result.success) return passFailure(result);
    if (!result.data) return notFoundFailure("Role", id);
    return success(result.data);
  },

  async createRole(input: unknown, ctx: ServiceContext): Promise<ApiResult<JsonRow>> {
    const parsed = roleCreateSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error.flatten());

    const existing = await roleRepository.findByName(String(parsed.data.name));
    if (!existing.success) return passFailure(existing);
    if (existing.data) {
      return duplicateFailure("name", parsed.data.name, "Role name already exists");
    }

    const seq = await roleRepository.listForSequence();
    if (!seq.success) return passFailure(seq);

    const row = {
      id: nextSequenceId((seq.data as { id: string }[]) || [], "ROL"),
      name: parsed.data.name,
      perms: parsed.data.perms || {}
    };

    const inserted = await roleRepository.insert(row);
    if (!inserted.success) return passFailure(inserted);
    if (!inserted.data) return failure("Failed to create role", ErrorCodes.internal);
    const audit = await writeMutationAudit(undefined, ctx.actor, {
      module: "roles",
      entity_id: String(inserted.data.id ?? row.id),
      action: "create",
      after: inserted.data,
      stamp: `Created role ${row.name}`
    });
    return finalizeWithAudit(audit, inserted.data);
  },

  async updateRole(
    id: string,
    input: unknown,
    ctx: ServiceContext
  ): Promise<ApiResult<JsonRow>> {
    const parsed = rolePatchSchema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error.flatten());
    const payload: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) payload.name = parsed.data.name;
    if (parsed.data.perms !== undefined) payload.perms = parsed.data.perms || {};
    if (Object.keys(payload).length === 0) {
      return failure("No editable fields supplied", ErrorCodes.badRequest);
    }
    const before = await roleRepository.findById(id);
    const updated = await roleRepository.update(id, payload);
    if (!updated.success) return passFailure(updated);
    if (!updated.data) return notFoundFailure("Role", id);
    const audit = await writeMutationAudit(undefined, ctx.actor, {
      module: "roles",
      entity_id: id,
      action: "update",
      before: before.success ? before.data ?? null : null,
      after: updated.data,
      stamp: `Updated role ${id}`
    });
    return finalizeWithAudit(audit, updated.data);
  },

  async deleteRole(
    id: string,
    ctx: ServiceContext
  ): Promise<ApiResult<{ id: string; deleted: true }>> {
    const inUse = await roleRepository.countUsersForRole(id);
    if (!inUse.success) return passFailure(inUse);
    if ((inUse.data ?? 0) > 0) {
      return failure(
        "Role is assigned to users; reassign first",
        ErrorCodes.conflict,
        { id, in_use: inUse.data }
      );
    }
    const before = await roleRepository.findById(id);
    const removed = await roleRepository.remove(id);
    if (!removed.success) return passFailure(removed);
    const audit = await writeMutationAudit(undefined, ctx.actor, {
      module: "roles",
      entity_id: id,
      action: "delete",
      before: before.success ? before.data ?? null : null,
      stamp: `Deleted role ${id}`
    });
    return finalizeWithAudit(audit, { id, deleted: true as const });
  }
};
