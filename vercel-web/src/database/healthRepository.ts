/**
 * Health repository — connectivity probes for `/api/v1/health`.
 *
 * Keeps the raw Supabase head-count query out of the route handler.
 */

import type { ApiResult } from "@/types/common";
import { adminClient } from "@/database/supabaseClient";

export interface SupabaseProbeResult {
  ok: boolean;
  error?: string;
}

export const healthRepository = {
  async probeSupabase(): Promise<ApiResult<SupabaseProbeResult>> {
    try {
      const { error } = await adminClient()
        .from("hh_users")
        .select("id", { count: "exact", head: true });
      return {
        success: true,
        data: { ok: !error, error: error?.message }
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: true, data: { ok: false, error: message } };
    }
  }
};
