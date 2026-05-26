/**
 * Health service — composes Supabase + external dependency probes
 * into a single ApiResult for /api/v1/health.
 */

import type { ApiResult } from "@/types/common";
import { hasOpenAI, hasWhatsApp } from "@/lib/api/env";
import { healthRepository } from "@/database/healthRepository";

export interface HealthSnapshot {
  service: string;
  version: number;
  time: string;
  deps: {
    supabase: { ok: boolean; error: string | null };
    openai: boolean;
    whatsapp: boolean;
  };
}

export const healthService = {
  async snapshot(): Promise<ApiResult<HealthSnapshot>> {
    const probe = await healthRepository.probeSupabase();
    const supabase =
      probe.success && probe.data
        ? { ok: probe.data.ok, error: probe.data.error ?? null }
        : { ok: false, error: probe.success ? null : probe.error || null };
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
        }
      }
    };
  }
};
