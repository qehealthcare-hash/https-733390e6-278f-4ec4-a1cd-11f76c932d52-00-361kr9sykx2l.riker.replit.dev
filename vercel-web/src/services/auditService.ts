/**
 * Audit log read service — append-only trail written by `mutationAudit`.
 */

import type { ApiResult } from "@/types/common";
import { auditListQuerySchema, type AuditListQuery } from "@/validation/auditValidation";
import { parseInput } from "@/validation/parseValidation";
import { auditRepository } from "@/database/auditRepository";
import type { JsonRow } from "@/database/types";
import { passFailure, success } from "@/utils/apiResponse";

export interface ActorLike {
  email: string;
  role?: string;
  accessToken?: string;
}

export interface AuditServiceContext {
  actor: ActorLike;
  accessToken?: string;
}

function dbAccess(ctx: AuditServiceContext) {
  const token = ctx.accessToken ?? ctx.actor.accessToken;
  return token ? { accessToken: token } : undefined;
}

function toApi(row: JsonRow) {
  return {
    id: row.id,
    module: row.module,
    entity_id: row.entity_id,
    action: row.action,
    actor: row.actor,
    user_id: row.user_id ?? null,
    stamp: row.stamp,
    before: row.before ?? null,
    after: row.after ?? null,
    payload: row.payload ?? {},
    created_at: row.created_at || null
  };
}

export const auditService = {
  async list(
    rawQuery: unknown,
    ctx: AuditServiceContext
  ): Promise<ApiResult<{ rows: ReturnType<typeof toApi>[]; total: number }>> {
    const parsed = parseInput(auditListQuerySchema, rawQuery ?? {});
    if (!parsed.success) return passFailure(parsed);
    const query = parsed.data as AuditListQuery;

    const result = await auditRepository.list(
      {
        limit: query.limit,
        offset: query.offset,
        module: query.module,
        entity_id: query.entity_id,
        action: query.action
      },
      dbAccess(ctx)
    );
    if (!result.success) return passFailure(result);

    const rows = (result.data?.rows || []).map((r) => toApi(r));
    return success({ rows, total: result.data?.total ?? rows.length });
  },

  async listByEntity(
    module: string,
    entityId: string,
    ctx: AuditServiceContext,
    limit = 100
  ): Promise<ApiResult<ReturnType<typeof toApi>[]>> {
    const result = await auditRepository.listByEntity(module, entityId, limit, dbAccess(ctx));
    if (!result.success) return passFailure(result);
    return success((result.data || []).map((r) => toApi(r)));
  }
};
