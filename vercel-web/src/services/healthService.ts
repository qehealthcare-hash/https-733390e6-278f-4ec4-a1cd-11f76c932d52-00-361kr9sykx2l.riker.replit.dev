/**
 * Health service — composes Supabase + external dependency probes
 * into a single ApiResult for /api/v1/health.
 */

import type { ApiResult } from "@/types/common";
import { hasOpenAI, hasWhatsApp } from "@/lib/api/env";
import { isObservabilityEnabled } from "@/lib/observability";
import { isProduction } from "@/lib/api/security";
import { healthRepository } from "@/database/healthRepository";

export interface HealthSnapshot {
  service: string;
  version: number;
  time: string;
  deps: {
    supabase: { ok: boolean; error: string | null; latency_ms: number | null };
    openai: boolean;
    whatsapp: boolean;
  };
  monitoring: {
    sentry: boolean;
  };
}

export const healthService = {
  async snapshot(): Promise<ApiResult<HealthSnapshot>> {
    const probe = await healthRepository.probeSupabase();
    const supabase =
      probe.success && probe.data
        ? {
            ok: probe.data.ok,
            latency_ms:
              typeof probe.data.latency_ms === "number" ? probe.data.latency_ms : null,
            error: isProduction()
              ? probe.data.ok
                ? null
                : "unavailable"
              : probe.data.error ?? null
          }
        : {
            ok: false,
            latency_ms: null,
            error: isProduction() ? "unavailable" : probe.success ? null : probe.error || null
          };
    return {
      success: true,
      data: {
        service: "hominal-crm-api",
        version: 1,
        time: new Date().toISOString(),
        deps: {
          supabase,
          openai: hasOpenAI(),
          whatsapp: hasWhatsApp()
        },
        monitoring: {
          sentry: isObservabilityEnabled()
        }
      }
    };
  }
};
