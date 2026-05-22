import type { ActorContext } from "./auth";
import { writeMutationAudit } from "@/services/mutationAudit";

export interface AuditEntry {
  module: string;
  entityId?: string | number | null;
  action: "create" | "update" | "delete" | "restore" | "convert" | "send" | "ai_query" | string;
  before?: unknown;
  after?: unknown;
  payload?: unknown;
  stamp?: string;
}

/**
 * Audit write for legacy `lib/api/services/*` shims.
 * Uses the same enforced path as domain services; logs on failure but does not throw
 * (shims are ancillary — WhatsApp / AI).
 */
export async function audit(actor: ActorContext | null, entry: AuditEntry): Promise<void> {
  const result = await writeMutationAudit(undefined, actor?.email || "system", {
    module: entry.module,
    entity_id: entry.entityId != null ? String(entry.entityId) : null,
    action: entry.action,
    stamp: entry.stamp,
    before: entry.before ?? null,
    after: entry.after ?? null,
    payload: entry.payload ?? {}
  });
  if (!result.success) {
    console.error("[audit] write failed", result.error, result.details);
  }
}
