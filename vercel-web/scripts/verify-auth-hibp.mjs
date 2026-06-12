#!/usr/bin/env node
/**
 * R5 / B4 — verify Supabase leaked-password (HIBP) protection is enabled.
 *
 * Requires a Supabase personal access token with project read access:
 *   export SUPABASE_ACCESS_TOKEN=sbp_...
 *   export SUPABASE_PROJECT_REF=hkyjxdmkqkydnrafhpgn   # optional; defaults below
 *   node scripts/verify-auth-hibp.mjs
 *
 * HIBP cannot be toggled via SQL; this script uses the Management API.
 * If the token is missing, prints manual steps and exits 0 (CI-friendly).
 */

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "hkyjxdmkqkydnrafhpgn";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_MANAGEMENT_TOKEN;

const MANUAL = [
  "Supabase Dashboard → Authentication → Providers → Email",
  "Enable **Leaked password protection** (Have I Been Pwned).",
  "Set minimum password length ≥ 12 for new users."
].join("\n  • ");

async function fetchAuthConfig() {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Management API ${res.status}: ${body.slice(0, 400)}`);
  }
  return res.json();
}

function hibpEnabled(config) {
  if (!config || typeof config !== "object") return false;
  if (config.security?.leaked_password_protection === true) return true;
  if (config.leaked_password_protection === true) return true;
  if (config.password_hibp_enabled === true) return true;
  return false;
}

async function main() {
  if (!TOKEN) {
    console.log("[verify-auth-hibp] No SUPABASE_ACCESS_TOKEN — manual check required:\n  • " + MANUAL);
    process.exit(0);
  }

  const config = await fetchAuthConfig();
  const enabled = hibpEnabled(config);
  const minLen = Number(config.password_min_length ?? config.security?.password_min_length ?? 0);

  if (!enabled) {
    console.error("[verify-auth-hibp] FAILED: leaked-password protection is disabled on", PROJECT_REF);
    console.error("  • " + MANUAL);
    process.exit(1);
  }

  if (minLen > 0 && minLen < 12) {
    console.warn(
      `[verify-auth-hibp] WARN: password_min_length is ${minLen}; recommend ≥ 12 (CRM reset-password enforces 12).`
    );
  }

  console.log("[verify-auth-hibp] OK: HIBP protection enabled on", PROJECT_REF);
}

main().catch(function (err) {
  console.error("[verify-auth-hibp] error:", err.message || err);
  console.error("  • " + MANUAL);
  process.exit(1);
});
