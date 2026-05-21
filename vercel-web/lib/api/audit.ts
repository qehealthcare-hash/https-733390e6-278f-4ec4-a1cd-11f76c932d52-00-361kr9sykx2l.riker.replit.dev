import { supabaseAdmin } from "./supabase";
import { env } from "./env";
import type { ActorContext } from "./auth";

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
 * Fire-and-forget audit write. Never throws.
 * Skipped when API_AUDIT_DISABLED=true (e.g. CI).
 */
export async function audit(actor: ActorContext | null, entry: AuditEntry): Promise<void> {
  if (env.auditDisabled) return;
  try {
    await supabaseAdmin().from("hh_audit_logs").insert({
      module: entry.module,
      entity_id: entry.entityId != null ? String(entry.entityId) : null,
      action: entry.action,
      actor: actor?.email || "system",
      stamp: entry.stamp || `${entry.action} by ${actor?.email || "system"} at ${new Date().toISOString()}`,
      before: entry.before ?? null,
      after: entry.after ?? null,
      payload: entry.payload ?? {}
    });
  } catch (err) {
    console.error("[audit] write failed", err);
  }
}
