import { supabaseAdmin } from "./supabase.js";

export async function recordAuditLog(payload) {
  const row = {
    module_name: payload.moduleName,
    action_name: payload.actionName,
    record_id: payload.recordId,
    actor_user_id: payload.actorUserId,
    actor_name: payload.actorName,
    metadata: payload.metadata || {}
  };

  await supabaseAdmin.from("audit_logs").insert(row);
}
