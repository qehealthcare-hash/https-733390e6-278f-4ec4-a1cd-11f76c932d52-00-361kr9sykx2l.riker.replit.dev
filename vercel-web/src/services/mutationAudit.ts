/**
 * Enforced audit writes for service-layer mutations (Phase 9).
 *
 * When `API_AUDIT_DISABLED` is not set, every mutation that calls
 * `writeMutationAudit` / `finalizeWithAudit` returns failure if the audit row
 * cannot be inserted — the API must not report success without a trail.
 */

import { env } from "@/lib/api/env";
import { auditRepository, type AuditInsertRow } from "@/database/auditRepository";
import type { DbAccess } from "@/database/types";
import type { ApiResult } from "@/types/common";
import { ErrorCodes } from "@/types/common";
import type { ServiceActor } from "@/types/serviceActor";
import { failure, success } from "@/utils/apiResponse";

export type MutationAuditPayload = Omit<AuditInsertRow, "actor" | "user_id">;

function resolveActor(actor: ServiceActor | string): { email: string; userId?: string } {
  if (typeof actor === "string") return { email: actor || "system" };
  return {
    email: actor.email || "system",
    userId: actor.userId
  };
}

export function isAuditDisabled(): boolean {
  return env.auditDisabled;
}

export async function writeMutationAudit(
  access: DbAccess | undefined,
  actor: ServiceActor | string,
  entry: MutationAuditPayload
): Promise<ApiResult<null>> {
  if (isAuditDisabled()) return success(null);

  const { email, userId } = resolveActor(actor);

  // Audit rows are written with the service-role client so RLS does not allow
  // authenticated users to forge arbitrary audit entries via PostgREST.
  const result = await auditRepository.insert(
    {
      ...entry,
      actor: email,
      user_id: userId ?? null,
      stamp: entry.stamp || `${entry.action} by ${email} at ${new Date().toISOString()}`
    },
    undefined
  );

  if (!result.success) {
    return failure(
      result.error || "Audit log write failed",
      ErrorCodes.audit,
      {
        module: entry.module,
        entity_id: entry.entity_id,
        action: entry.action,
        upstream: result.details
      }
    );
  }

  return success(null);
}

/**
 * Complete a mutation response only when audit persistence succeeded.
 * On audit failure the payload was already saved — `details.persisted` is true.
 */
export function finalizeWithAudit<T>(
  auditResult: ApiResult<null>,
  data: T
): ApiResult<T> {
  if (auditResult.success) return success(data);
  return failure(
    auditResult.error || "Audit log write failed",
    auditResult.code || ErrorCodes.audit,
    {
      ...(typeof auditResult.details === "object" && auditResult.details !== null
        ? (auditResult.details as Record<string, unknown>)
        : {}),
      persisted: true,
      warning:
        "The database change was saved but could not be written to the audit log. Retry or contact an administrator."
    }
  );
}
