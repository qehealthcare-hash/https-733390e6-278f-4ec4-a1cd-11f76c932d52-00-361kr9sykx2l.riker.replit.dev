/**
 * Follow-up audit (2026-05-28) regression tests.
 *
 * Each row in audit-rubric.md added by the deep audit (P0-8, P0-9, P1-39
 * through P1-53) gets one test here. Every test in this file is expected
 * to FAIL on the commit that adds it (the fix lands in a follow-up commit
 * carrying the finding ID); after the fix the test flips green and stays
 * that way for the lifetime of the rubric.
 *
 * Static-grep style — same cheap probes as p0.test.ts / p1.test.ts. No DB
 * round-trip required.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readWeb, existsWeb, REPO, WEB } from "./helpers";

function readRepo(rel: string): string {
  const full = join(REPO, rel);
  if (!existsSync(full)) throw new Error("MISSING_FILE: " + rel);
  return readFileSync(full, "utf8");
}

function walkApp(): string[] {
  const root = join(WEB, "app");
  const out: string[] = [];
  function walk(dir: string) {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(js|jsx|ts|tsx)$/.test(e.name)) out.push(full);
    }
  }
  walk(root);
  return out;
}

/**
 * Extract the function body for a `CREATE OR REPLACE FUNCTION public.<name>`
 * declaration in a Postgres migration (`$function$ ... $function$`). Returns
 * `null` when the function is not present.
 */
function extractPgFunction(sql: string, name: string): string | null {
  const start = sql.search(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b`, "i"));
  if (start < 0) return null;
  const fromStart = sql.slice(start);
  const open = fromStart.indexOf("$function$");
  if (open < 0) return null;
  const close = fromStart.indexOf("$function$", open + "$function$".length);
  if (close < 0) return null;
  return fromStart.slice(open, close + "$function$".length);
}

describe("Follow-up audit (2026-05-28) — new P0/P1 regressions", () => {
  // ─── P0 ─────────────────────────────────────────────────────────────────────

  it("P0-8: hh_recompute_payout does not mint payout ids with random()", () => {
    const sql = readWeb("supabase/migrations/20260528104000_p1_integrity.sql");
    const body = extractPgFunction(sql, "hh_recompute_payout");
    expect(body, "could not locate hh_recompute_payout in 20260528104000_p1_integrity.sql").not.toBeNull();
    // Disallow any random() call inside the function body. gen_random_uuid /
    // gen_random_bytes / a sequence is required for collision-free ids.
    const usesRandom = /\brandom\s*\(/i.test(body || "");
    expect(usesRandom, "hh_recompute_payout still uses random() to generate payout ids — replace with gen_random_uuid() / a sequence").toBe(false);
  });

  it("P0-9: hh_idempotency has updated_at AND reservation has a TTL / stale-takeover", () => {
    // Find the security-hardening migration that defines hh_idempotency.
    const migDir = join(WEB, "supabase/migrations");
    const files = existsSync(migDir) ? readdirSync(migDir).filter((f) => f.endsWith(".sql")) : [];
    let createSql = "";
    for (const f of files) {
      const text = readFileSync(join(migDir, f), "utf8");
      if (/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.hh_idempotency/i.test(text)) {
        createSql = text;
        break;
      }
    }
    expect(createSql, "no migration creates public.hh_idempotency").not.toBe("");
    const hasUpdatedAt = /updated_at\s+timestamptz/i.test(createSql);
    expect(hasUpdatedAt, "hh_idempotency table is missing an updated_at timestamptz column (violates internal rule #8)").toBe(true);

    const idemTs = readWeb("lib/api/idempotency.ts");
    const idemRepo = existsWeb("src/database/idempotencyRepository.ts")
      ? readWeb("src/database/idempotencyRepository.ts")
      : "";
    const combined = idemTs + "\n" + idemRepo;
    // After fix one of: explicit stale-takeover (interval '30 seconds'), a
    // pending TTL constant, or a takeover comment-anchored pattern.
    const hasStaleTakeover =
      /interval\s+'(?:30|60|90|120)\s*seconds?'/i.test(combined) ||
      /PENDING_TTL_MS|pendingTtlMs|takeoverStalePending|reclaimStalePending/.test(combined);
    expect(hasStaleTakeover, "idempotency layer has no TTL / stale-takeover for PENDING rows — a crashed reservation will permanently brick the key").toBe(true);
  });

  // ─── P1 (security) ──────────────────────────────────────────────────────────

  it("P1-39: CSP script-src does not contain 'unsafe-inline'", () => {
    const src = readWeb("next.config.mjs");
    // Extract the CSP value (joined from the array literal).
    const cspMatch = src.match(/Content-Security-Policy[\s\S]{0,400}?value:\s*\[([\s\S]*?)\]\.join/);
    expect(cspMatch, "could not locate the Content-Security-Policy value in next.config.mjs").not.toBeNull();
    const cspBlob = (cspMatch?.[1] || "").toLowerCase();
    const scriptSrcLine = cspBlob.split(/,\s*/).find((l) => l.includes("script-src")) || "";
    const hasUnsafeInline = /['"]unsafe-inline['"]/.test(scriptSrcLine);
    expect(hasUnsafeInline, "CSP script-src still contains 'unsafe-inline' — adopt nonce/hash-based inline policy instead").toBe(false);
  });

  it("P1-40: production response carries a long-lived Strict-Transport-Security header", () => {
    const src = readWeb("next.config.mjs");
    const hasHsts = /Strict-Transport-Security/i.test(src);
    expect(hasHsts, "next.config.mjs declares no Strict-Transport-Security header").toBe(true);
    if (hasHsts) {
      // Extract the header object's value and assert max-age >= 1y and includeSubDomains.
      const valMatch = src.match(/Strict-Transport-Security[\s\S]{0,200}?value:\s*["']([^"']+)["']/);
      const val = valMatch?.[1] || "";
      const maxAgeMatch = val.match(/max-age=(\d+)/i);
      const maxAge = maxAgeMatch ? Number(maxAgeMatch[1]) : 0;
      expect(maxAge, `HSTS max-age is ${maxAge} — must be at least 31536000 (1 year)`).toBeGreaterThanOrEqual(31536000);
      expect(/includeSubDomains/i.test(val), "HSTS header is missing includeSubDomains").toBe(true);
    }
  });

  it("P1-41: aiService scrubs PHI before sending CRM context to the upstream LLM", () => {
    const src = readWeb("src/services/aiService.ts");
    // After the fix one of:
    //   1) an explicit scrubPhi / redactPhi / sanitizeForLlm helper wraps `chunks`
    //   2) the upstream URL is env-configurable (Azure-OpenAI / private DPA pattern)
    const hasScrubber =
      /(scrubPhi|redactPhi|sanitizePhi|sanitizeForLlm|stripPhi|sanitizeForAi)\s*\(/.test(src);
    const envConfigurable =
      /OPENAI_BASE_URL|AI_BASE_URL|AZURE_OPENAI_/i.test(src);
    expect(
      hasScrubber || envConfigurable,
      "aiService still ships raw patient context to api.openai.com — wrap chunks in a PHI-scrubber OR route to a configurable OPENAI_BASE_URL"
    ).toBe(true);
    // And the raw JSON.stringify path must NOT directly feed the OpenAI fetch
    // without going through a scrubber.
    if (!envConfigurable) {
      const rawDump = /JSON\.stringify\s*\(\s*chunks\s*\)/.test(src);
      expect(rawDump, "aiService sends JSON.stringify(chunks) verbatim to the LLM — wrap in a PHI-scrubber").toBe(false);
    }
  });

  it("P1-42: refresh token leaves the login route via HttpOnly cookie, not the JSON body", () => {
    const route = readWeb("app/api/v1/auth/login/route.ts");
    const ap = readWeb("components/providers/auth-provider.js");
    // Route must Set-Cookie an HttpOnly refresh-token cookie OR omit
    // refresh_token from the JSON body.
    const setsHttpOnly = /Set-Cookie[\s\S]{0,200}HttpOnly[\s\S]{0,200}refresh/i.test(route) ||
      /cookies\(\)\.set\([\s\S]{0,200}refresh[\s\S]{0,200}httpOnly/i.test(route);
    const stillReturnsInBody = /refresh_token:\s*tokenBody\.refresh_token/.test(route);
    expect(
      setsHttpOnly || !stillReturnsInBody,
      "login route still returns refresh_token in the JSON body — set it as an HttpOnly cookie instead"
    ).toBe(true);
    // Client must not pass a non-empty refresh_token to supabase.auth.setSession.
    const clientPassesRefresh = /setSession\s*\(\s*\{[\s\S]{0,200}refresh_token:\s*tokens\.refresh_token/.test(ap);
    expect(
      clientPassesRefresh,
      "auth-provider.js still hands a refresh_token from the login JSON body into supabase.auth.setSession — refresh token must live in an HttpOnly cookie"
    ).toBe(false);
  });

  it("P1-43: signed-download enforces a per-bucket role allow-list (Nurse can't pull payroll proofs)", () => {
    const src = readWeb("src/services/storageService.ts");
    // Isolate the createSignedDownload function body so a docstring elsewhere
    // can't satisfy the check.
    const idx = src.indexOf("createSignedDownload");
    expect(idx, "createSignedDownload not found in storageService.ts").toBeGreaterThanOrEqual(0);
    const body = src.slice(idx, idx + 3000);
    // After the fix the function body references one of:
    //   * a named per-bucket roles map (BUCKET_READ_ROLES / bucketReadRoles /
    //     ROLES_BY_BUCKET / getBucketReadRoles(bucket))
    //   * an explicit `bucket === 'payout-proofs'` check (or .equals) coupled
    //     with a narrower role set
    const perBucket =
      /BUCKET_READ_ROLES|bucketReadRoles|ROLES_BY_BUCKET|ROLES_PER_BUCKET|getBucketReadRoles\s*\(/.test(body) ||
      /bucket\s*===\s*["'`]payout-proofs["'`]/.test(body);
    expect(
      perBucket,
      "createSignedDownload uses a single READ_ROLES set for every bucket — Nurse can mint signed URLs for payout-proofs. Adopt a per-bucket role allow-list (e.g. BUCKET_READ_ROLES map)."
    ).toBe(true);
  });

  // ─── P1 (integrity) ────────────────────────────────────────────────────────

  it("P1-44: duties-extend cron acquires an advisory lock or rides a long-TTL idempotency window", () => {
    const route = readWeb("app/api/v1/cron/duties-extend/route.ts");
    const svc = readWeb("src/services/dutyService.ts");
    const guarded =
      /pg_advisory_lock\s*\(|withPgAdvisoryLock\s*\(|hashtext\s*\(\s*['"]cron:duties-extend['"]/.test(route + svc) ||
      /withIdempotency[\s\S]{0,300}ttlMs\s*:\s*[\s\S]{0,40}(60\s*\*\s*60\s*\*\s*1000|3_600_000|3600000)/.test(route);
    expect(
      guarded,
      "duties-extend cron has no advisory lock and no idempotency cooldown — two overlapping cron runs will duplicate hh_svc_entries / hh_payout_charges"
    ).toBe(true);
  });

  it("P1-45: hh_duty_days.svc_entry_id FK is NOT ON DELETE CASCADE", () => {
    const sql = readWeb("supabase/migrations/20260526150000_hh_duty_days_ledger.sql");
    const stillCascade = /svc_entry_id[\s\S]{0,200}on\s+delete\s+cascade/i.test(sql);
    expect(
      stillCascade,
      "hh_duty_days.svc_entry_id is still ON DELETE CASCADE — purges paid-ledger trail. Switch to RESTRICT (or SET NULL with a soft-delete column)."
    ).toBe(false);
  });

  it("P1-46: human-readable id generators do not rely on Math.random()", () => {
    const a = readWeb("lib/api/ids.ts");
    const b = existsWeb("src/business/idRules.ts") ? readWeb("src/business/idRules.ts") : "";
    const combined = a + "\n" + b;
    const usesMathRandom = /Math\.random\s*\(/.test(combined);
    expect(
      usesMathRandom,
      "lib/api/ids.ts and/or src/business/idRules.ts still use Math.random() for receipt/payout/billing IDs — collisions on burst writes silently overwrite. Use crypto.randomUUID() or a pg sequence."
    ).toBe(false);
  });

  it("P1-47: doctors / vendors / users list pages either paginate or show a cap banner", () => {
    const files = [
      "app/doctors/page.js",
      "app/vendors/page.js",
      "app/users/page.js"
    ];
    const missing: string[] = [];
    for (const f of files) {
      const src = readWeb(f);
      const guarded =
        /usePaginatedResource\s*\(/.test(src) ||
        /Showing\s+first\s+|refine\s+filters|truncat/i.test(src);
      if (!guarded) missing.push(f);
    }
    expect(missing, `List pages still silently truncate (no banner, no pagination):\n${missing.join("\n")}`).toEqual([]);
  });

  it("P1-48: no `new Date().toISOString().slice(0,10)` remains anywhere under app/**", () => {
    const files = walkApp();
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const count = (src.match(/new\s+Date\(\)\.toISOString\(\)\.slice\(\s*0\s*,\s*10\s*\)/g) || []).length;
      if (count) offenders.push(f.replace(REPO + "/", "") + " × " + count);
    }
    expect(offenders, `UTC slice(0,10) still in app/**:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("P1-49: lib/config.js does not statically import the 1.4 MB company-logo data URI", () => {
    const cfg = readWeb("lib/config.js");
    const staticImport = /^\s*import\b[^;]*company-logo/m.test(cfg);
    expect(
      staticImport,
      "lib/config.js still statically imports lib/company-logo.js — the 1.4 MB base64 logo lands in the shared client chunk. Lazy-load or move to /public/."
    ).toBe(false);
  });

  it("P1-50: page-local modals carry role=\"dialog\" + aria-modal (or use the shared ConfirmDialog)", () => {
    const files = [
      "app/duties/page.js",
      "app/employees/page.js",
      "app/inquiries/page.js",
      "app/payouts/payouts-inner.js",
      "app/patients/page.js"
    ];
    const missing: string[] = [];
    for (const f of files) {
      const src = readWeb(f);
      // count naked .modal-card occurrences and matching role="dialog" tags.
      const cards = (src.match(/className=["'`][^"'`]*modal-card/g) || []).length;
      if (cards === 0) continue;
      const dialogs = (src.match(/role=["'`]dialog["'`]/g) || []).length;
      const ariaModals = (src.match(/aria-modal=/g) || []).length;
      if (dialogs < cards || ariaModals < cards) {
        missing.push(`${f}: ${cards} modal-card(s), ${dialogs} role="dialog", ${ariaModals} aria-modal`);
      }
    }
    expect(missing, `Modals missing dialog semantics:\n${missing.join("\n")}`).toEqual([]);
  });

  it("P1-51: bare `<div>Loading…</div>` indicators carry role=\"status\" or aria-live", () => {
    const files = walkApp();
    const offenders: string[] = [];
    // Match `<div … >Loading…</div>` (and p/span/h1..h6) where the tag body
    // begins with a loading literal and the opening tag has no role/aria-*.
    // Negative lookahead inside `[^>]*` lets us ignore tags that are already
    // accessible. Component props (e.g. `<EmptyState title={loading ? …}`)
    // do not match because the opening tag isn't div/p/span/hN.
    const re = /<(div|p|span|h[1-6])\b([^>]*)>\s*\{?\s*['"`]?(Loading|Refreshing|Working|Saving)[^<]*<\/\1>/g;
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const attrs = m[2] || "";
        if (
          !/role=["'`]status["'`]/.test(attrs) &&
          !/aria-live=/.test(attrs) &&
          !/aria-busy=/.test(attrs)
        ) {
          offenders.push(`${f.replace(REPO + "/", "")} :: ${m[0].slice(0, 100)}`);
        }
      }
    }
    expect(
      offenders.length,
      `Bare loading indicators missing role="status" / aria-live / aria-busy:\n${offenders.slice(0, 20).join("\n")}${offenders.length > 20 ? `\n…and ${offenders.length - 20} more` : ""}`
    ).toBe(0);
  });

  it("P1-52: lib/csv.js prepends BOM and escapes formula-injection-prone leading characters", () => {
    const src = readWeb("lib/csv.js");
    const hasBom = /\\uFEFF|"\uFEFF"|'\uFEFF'/.test(src);
    expect(hasBom, "lib/csv.js does not prepend \\uFEFF BOM — Excel will mangle ₹ / accented names").toBe(true);
    const guardsFormula =
      /=\s*\+\s*-\s*@/.test(src) || // "=+-@" mentioned in a regex
      /\[\s*['"]=['"]\s*,\s*['"]\+['"]\s*,\s*['"]-['"]/.test(src) ||
      /(formula|CWE-1236|injection)/i.test(src);
    expect(guardsFormula, "lib/csv.js does not escape leading =, +, -, @ in cell values (CSV formula injection, CWE-1236)").toBe(true);
  });

  it("P1-53: target=\"_blank\" anchors emitted into proof / document HTML carry rel=\"noopener noreferrer\"", () => {
    const files = [
      "app/payouts/payouts-inner.js",
      "app/patients/page.js",
      "app/employees/page.js"
    ];
    const offenders: string[] = [];
    for (const f of files) {
      const src = readWeb(f);
      // Match every `target='_blank'` (or "_blank") in an HTML-string concat
      // and verify the same anchor carries `noopener noreferrer`. We
      // accept either order, single/double quotes, and HTML-attr-style or
      // JSX-style anchors.
      const re = /<a\b[^>]*target=["'`]_blank["'`][^>]*>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const tag = m[0];
        const hasOpener = /rel=["'`][^"'`]*noopener[^"'`]*["'`]/.test(tag);
        const hasReferrer = /rel=["'`][^"'`]*noreferrer[^"'`]*["'`]/.test(tag);
        if (!hasOpener || !hasReferrer) {
          offenders.push(`${f} :: ${tag.slice(0, 100)}`);
        }
      }
    }
    expect(offenders, `target="_blank" anchors missing rel="noopener noreferrer":\n${offenders.join("\n")}`).toEqual([]);
  });
});
