/**
 * Health repository — connectivity probes for `/api/v1/health`.
 *
 * Uses a minimal RPC (`hominal_health_ping`) so the probe does not scan
 * `hh_users` and fails fast when PostgREST is unhealthy.
 */

import type { ApiResult } from "@/types/common";
import { env } from "@/lib/api/env";
import { adminClient } from "@/database/supabaseClient";

export interface SupabaseProbeResult {
  ok: boolean;
  error?: string;
  latency_ms?: number;
}

const PROBE_TIMEOUT_MS = 8_000;

function probeTimeout(): Promise<{ data: null; error: { message: string } }> {
  return new Promise((resolve) => {
    setTimeout(
      () => resolve({ data: null, error: { message: "probe timeout" } }),
      PROBE_TIMEOUT_MS
    );
  });
}

export const healthRepository = {
  async probeSupabase(): Promise<ApiResult<SupabaseProbeResult>> {
    if (!env.supabaseServiceRoleKey) {
      return {
        success: true,
        data: { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not configured" }
      };
    }

    try {
      const started = Date.now();
      const probe = adminClient().rpc("hominal_health_ping");
      const { data, error } = await Promise.race([probe, probeTimeout()]);
      const latency_ms = Date.now() - started;
      const ok =
        !error &&
        data != null &&
        typeof data === "object" &&
        (data as { ok?: boolean }).ok === true;
      return {
        success: true,
        data: { ok, error: error?.message, latency_ms }
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: true, data: { ok: false, error: message } };
    }
  }
};
