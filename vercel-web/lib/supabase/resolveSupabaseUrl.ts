/**
 * Align Supabase URL with the project ref embedded in the anon/service JWT.
 * Prevents production misconfigurations (e.g. `hkyjxdmkqydnrafhpgn` missing a "k")
 * from breaking browser auth/realtime while API routes still work via server env.
 */

const CANONICAL_PROJECT_REF = "hkyjxdmkqkydnrafhpgn";

/** Known typo seen on Vercel env — missing "k" after "mq". */
const KNOWN_BAD_HOSTS = new Set([
  "hkyjxdmkqydnrafhpgn.supabase.co"
]);

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = String(jwt || "").split(".");
  if (parts.length < 2) return null;
  try {
    const b64 = (parts[1] || "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json =
      typeof atob === "function"
        ? atob(padded)
        : Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function projectRefFromSupabaseKey(supabaseKey: string): string | null {
  const payload = decodeJwtPayload(supabaseKey);
  const ref = payload?.ref;
  return typeof ref === "string" && ref.trim() ? ref.trim() : null;
}

export function canonicalSupabaseUrl(projectRef: string): string {
  const ref = String(projectRef || "").trim() || CANONICAL_PROJECT_REF;
  return "https://" + ref + ".supabase.co";
}

export type ResolveSupabaseUrlResult = {
  url: string;
  corrected: boolean;
  projectRef: string;
};

/**
 * Returns the Supabase REST/auth base URL. When the anon key's `ref` claim
 * disagrees with NEXT_PUBLIC_SUPABASE_URL (or a known typo host is used),
 * the JWT ref wins so browser auth + realtime stay on the real project.
 */
export function resolveSupabaseUrl(
  configuredUrl: string,
  supabaseKey: string
): ResolveSupabaseUrlResult {
  const trimmedUrl = String(configuredUrl || "").trim();
  const keyRef = projectRefFromSupabaseKey(supabaseKey);
  const projectRef = keyRef || CANONICAL_PROJECT_REF;
  const canonical = canonicalSupabaseUrl(projectRef);

  let host = "";
  try {
    host = new URL(trimmedUrl).host;
  } catch {
    return { url: canonical, corrected: true, projectRef };
  }

  const expectedHost = projectRef + ".supabase.co";
  if (host === expectedHost) {
    return { url: trimmedUrl.replace(/\/+$/, ""), corrected: false, projectRef };
  }

  if (KNOWN_BAD_HOSTS.has(host) || host !== expectedHost) {
    if (typeof console !== "undefined" && console.warn) {
      console.warn(
        "[supabase] NEXT_PUBLIC_SUPABASE_URL host '" +
          host +
          "' does not match anon key ref '" +
          projectRef +
          "'; using " +
          canonical
      );
    }
    return { url: canonical, corrected: true, projectRef };
  }

  return { url: trimmedUrl.replace(/\/+$/, ""), corrected: false, projectRef };
}
