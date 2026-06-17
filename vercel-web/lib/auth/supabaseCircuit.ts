/**
 * In-process circuit breaker for Supabase connectivity.
 * When the database is overloaded, fail fast instead of queuing more
 * GoTrue / PostgREST work that deepens lock contention.
 */

const CIRCUIT_OPEN_MS = 90_000;
const FAST_PROBE_MS = 2_500;

let openUntil = 0;
let lastProbeAt = 0;
let lastProbeOk = true;

export function isSupabaseCircuitOpen(): boolean {
  return Date.now() < openUntil;
}

export function openSupabaseCircuit(): void {
  openUntil = Date.now() + CIRCUIT_OPEN_MS;
  lastProbeOk = false;
}

export function closeSupabaseCircuit(): void {
  openUntil = 0;
  lastProbeOk = true;
}

function probeTimeout(): Promise<{ data: null; error: { message: string } }> {
  return new Promise((resolve) => {
    setTimeout(
      () => resolve({ data: null, error: { message: "probe timeout" } }),
      FAST_PROBE_MS
    );
  });
}

/**
 * Lightweight health check with a short timeout. Caches the result for 5s
 * so burst login attempts do not amplify load.
 */
export async function probeSupabaseFast(): Promise<boolean> {
  const now = Date.now();
  if (isSupabaseCircuitOpen()) return false;
  if (now - lastProbeAt < 5_000) return lastProbeOk;

  lastProbeAt = now;
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(
    /\/$/,
    ""
  );
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    lastProbeOk = false;
    openSupabaseCircuit();
    return false;
  }

  try {
    const probe = fetch(`${url}/rest/v1/rpc/hominal_health_ping`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: "{}"
    });
    const res = await Promise.race([probe, probeTimeout()]);
    if (!("ok" in res)) {
      lastProbeOk = false;
      openSupabaseCircuit();
      return false;
    }
    const ok = res.ok;
    if (!ok) {
      lastProbeOk = false;
      openSupabaseCircuit();
      return false;
    }
    const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    lastProbeOk = body?.ok === true;
    if (!lastProbeOk) openSupabaseCircuit();
    return lastProbeOk;
  } catch {
    lastProbeOk = false;
    openSupabaseCircuit();
    return false;
  }
}
