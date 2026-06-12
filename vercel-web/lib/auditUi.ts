/**
 * Audit log UI row shape for the audits page.
 */

export interface AuditLogRow {
  id: string;
  module?: string;
  entity_id?: string;
  action?: string;
  actor?: string;
  user_id?: string;
  stamp?: string;
  created_at?: string;
}
