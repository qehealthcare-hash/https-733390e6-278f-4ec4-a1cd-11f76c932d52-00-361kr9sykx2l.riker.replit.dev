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
import {
  auditProbeOk,
  readAllMigrations,
  readWeb,
  readWebResolved,
  existsWeb,
  REPO,
  WEB
} from "./helpers";

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
    const fixPath = "supabase/migrations/20260601140000_audit_followup_fixes.sql";
    const sql = existsWeb(fixPath)
      ? readWeb(fixPath)
      : readWeb("supabase/migrations/20260528104000_p1_integrity.sql");
    const body = extractPgFunction(sql, "hh_recompute_payout");
    expect(body, "could not locate hh_recompute_payout in migrations").not.toBeNull();
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
    const fixPath = "supabase/migrations/20260601140000_audit_followup_fixes.sql";
    const fixSql = existsWeb(fixPath) ? readWeb(fixPath) : "";
    const hasUpdatedAt = /updated_at\s+timestamptz/i.test(createSql + "\n" + fixSql);
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
    const middleware = existsWeb("middleware.ts") ? readWeb("middleware.ts") : "";
    const nextCfg = readWeb("next.config.mjs");
    const cspBlob = (middleware + "\n" + nextCfg).toLowerCase();
    // Match only the script-src directive (semicolon-terminated or backtick-terminated in source).
    const scriptSrcChunks =
      cspBlob.match(/script-src[^;`]+/g)?.filter((line) => !line.includes("style-src")) || [];
    const hasUnsafeInline = scriptSrcChunks.some((line) => /['"]unsafe-inline['"]/.test(line));
    const hasNonce =
      /['"]nonce-\$\{nonce\}['"]/.test(middleware) ||
      /nonce-\$\{nonce\}/.test(middleware);
    expect(
      hasUnsafeInline,
      "CSP script-src still contains 'unsafe-inline' — adopt nonce/hash-based inline policy instead"
    ).toBe(false);
    expect(
      hasNonce,
      "middleware.ts must set script-src with a per-request nonce (see Next.js CSP guide)"
    ).toBe(true);
  });

  it("P1-D (submit): primary save forms use useBusyGuard tryBegin reentrancy guard", () => {
    const hook = readWeb("hooks/use-busy-guard.ts");
    expect(hook).toMatch(/tryBegin/);
    const pages = [
      "app/login/page.tsx",
      "app/inquiries/page.tsx",
      "app/patients/page.tsx",
      "app/employees/page.tsx",
      "app/duties/page.tsx",
      "app/billings/page.tsx"
    ];
    const missing: string[] = [];
    for (const rel of pages) {
      const src = readWebResolved(rel);
      if (!/useBusyGuard/.test(src) || !/tryBegin\(\)/.test(src)) missing.push(rel);
    }
    expect(
      missing,
      "Save/submit pages must use useBusyGuard().tryBegin() to block double-submit:\n" + missing.join("\n")
    ).toEqual([]);
  });

  it("P1-E (a11y): mapped form fields use unique ids (no duplicated auto-generated labels in lists)", () => {
    const patients = readWebResolved("app/patients/page.tsx");
    expect(patients).not.toMatch(/patients-relative-index-1-name-in-18/);
    expect(patients).toMatch(/patients-relative-.*\+ index/);

    const duties = readWebResolved("app/duties/page.tsx");
    expect(duties).not.toMatch(/htmlFor="duties-partner-11"/);
    expect(duties).toMatch(/row_id/);

    const employees = readWebResolved("app/employees/page.tsx");
    expect(employees).not.toMatch(/htmlFor="employees-label-27"/);
    expect(employees).toMatch(/employees-score-/);
  });

  it("P1-F (react): extra duty partners key on stable row_id, not array index", () => {
    const duties = readWebResolved("app/duties/page.tsx");
    const partnersBlock = duties.slice(
      duties.indexOf("form.extra_partners.map"),
      duties.indexOf("form.extra_partners.map") + 800
    );
    expect(partnersBlock).toMatch(/key=\{p\.row_id\}/);
    expect(partnersBlock).not.toMatch(/key=\{idx\}/);
  });

  it("P1-C (confirm): app pages use ConfirmProvider instead of window.confirm / window.prompt", () => {
    const offenders: string[] = [];
    for (const f of walkApp()) {
      const rel = f.replace(REPO + "/", "");
      const src = readFileSync(f, "utf8");
      if (/window\.(confirm|prompt)\s*\(/.test(src)) offenders.push(rel);
    }
    expect(
      offenders,
      "Pages still call window.confirm/window.prompt — use useConfirm() and a reason modal instead:\n" +
        offenders.join("\n")
    ).toEqual([]);
  });

  it("P1-E (camera): CSP media-src allows live preview; Permissions-Policy grants camera on self", () => {
    const mw = existsWeb("middleware.ts") ? readWeb("middleware.ts") : "";
    const cfg = readWeb("next.config.mjs");
    expect(
      /media-src[^;]*mediastream/i.test(mw),
      "middleware CSP missing media-src … mediastream: — getUserMedia preview on <video srcObject> will be blocked"
    ).toBe(true);
    const policyBlob = mw + "\n" + cfg;
    expect(
      /camera=\(self\)/i.test(policyBlob),
      "Permissions-Policy must include camera=(self) for patient/employee photo capture"
    ).toBe(true);
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
    const ap = readWebResolved("components/providers/auth-provider.js");
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
    const ledger = readWeb("supabase/migrations/20260526150000_hh_duty_days_ledger.sql");
    const fixPaths = [
      "supabase/migrations/20260601140000_audit_followup_fixes.sql",
      "supabase/migrations/20260601150000_duty_days_fk_set_null.sql"
    ];
    const fixSql = fixPaths
      .filter((p) => existsWeb(p))
      .map((p) => readWeb(p))
      .join("\n");
    const fkPreservesLedger = /on\s+delete\s+(?:restrict|set\s+null)/i.test(fixSql);
    const stillCascade =
      /svc_entry_id[\s\S]{0,200}on\s+delete\s+cascade/i.test(ledger) && !fkPreservesLedger;
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
      const src = readWebResolved(f);
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

  it("P1-49: lib/config does not statically import the 1.4 MB company-logo data URI", () => {
    const cfgPath = existsSync(join(WEB, "lib/config.ts"))
      ? "lib/config.ts"
      : "lib/config.js";
    const cfg = readWeb(cfgPath);
    const staticImport = /^\s*import\b[^;]*company-logo/m.test(cfg);
    expect(
      staticImport,
      `${cfgPath} still statically imports lib/company-logo.js — the 1.4 MB base64 logo lands in the shared client chunk. Use /public/company-logo.png or lazy-load.`
    ).toBe(false);
  });

  it("P1-50: page-local modals carry role=\"dialog\" + aria-modal (or use ModalDialog / ConfirmDialog)", () => {
    const files = [
      "app/duties/page.js",
      "app/employees/page.js",
      "app/inquiries/page.js",
      "app/payouts/payouts-inner.js",
      "app/patients/page.js"
    ];
    const missing: string[] = [];
    for (const f of files) {
      const src = readWebResolved(f);
      const cards = (src.match(/className=["'`][^"'`]*modal-card/g) || []).length;
      if (cards === 0) continue;
      const modalDialogs = (src.match(/<ModalDialog\b/g) || []).length;
      const dialogs = (src.match(/role=["'`]dialog["'`]/g) || []).length;
      const ariaModals = (src.match(/aria-modal=/g) || []).length;
      const wrapped = modalDialogs >= cards;
      const inlineSemantics = dialogs >= cards && ariaModals >= cards;
      if (!wrapped && !inlineSemantics) {
        missing.push(
          `${f}: ${cards} modal-card(s), ${modalDialogs} ModalDialog, ${dialogs} role="dialog", ${ariaModals} aria-modal`
        );
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

  it("P1-B (billings): PATCH/status/close/reopen send expected_updated_at and handle conflict UI", () => {
    const src = readWeb("app/billings/page.tsx");
    expect(src).toMatch(/expected_updated_at/);
    expect(src).toMatch(/expectedUpdatedAt/);
    expect(src).toMatch(/conflictPrompt/);
    expect(src).toMatch(/reloadBillingFromConflict/);
    expect(src).toMatch(/submitCloseBill[\s\S]*payload\.expected_updated_at/);
    expect(src).toMatch(/submitReopenBill[\s\S]*payload\.expected_updated_at/);
  });

  it("P1-B (billing smoke): integration suite covers billing HTTP optimistic-lock paths", () => {
    const src = readWeb("src/integration/__tests__/billingModule.smoke.test.ts");
    expect(src).toMatch(/expected_updated_at/);
    expect(src).toMatch(/BillingClosePost/);
    expect(src).toMatch(/BillingReopenPost/);
    expect(src).toMatch(/409.*conflict/s);
  });

  it("P1-B (payouts): lifecycle mutations send expected_updated_at and handle conflict UI", () => {
    const src = readWeb("app/payouts/payouts-inner.tsx");
    expect(src).toMatch(/expected_updated_at/);
    expect(src).toMatch(/expectedUpdatedAt/);
    expect(src).toMatch(/conflictPrompt/);
    expect(src).toMatch(/reloadPayoutFromConflict/);
    expect(src).toMatch(/handleLock[\s\S]*payload\.expected_updated_at/);
    expect(src).toMatch(/handleReopen[\s\S]*payload\.expected_updated_at/);
    expect(src).toMatch(/handlePay[\s\S]*body\.expected_updated_at/);
  });

  it("P1-B (payout smoke): integration suite covers payout HTTP optimistic-lock paths", () => {
    const src = readWeb("src/integration/__tests__/payoutModule.smoke.test.ts");
    expect(src).toMatch(/PayoutLockPost/);
    expect(src).toMatch(/PayoutReopenPost/);
    expect(src).toMatch(/409.*conflict/s);
  });

  it("Auth smoke: login/me/refresh/health integration suite exists", () => {
    const src = readWeb("src/integration/__tests__/authModule.smoke.test.ts");
    expect(src).toMatch(/LoginPost/);
    expect(src).toMatch(/refresh_token\)\.toBeUndefined/);
    expect(src).toMatch(/MeGet/);
    expect(src).toMatch(/HealthGet/);
  });

  it("P1-B (dashboard): fetchKpis reads session via sessionRef (no stale session closure)", () => {
    const src = readWeb("app/dashboard/page.tsx");
    expect(src).toMatch(/const sessionRef = useRef/);
    expect(src).toMatch(/sessionRef\.current = auth\?\.session/);
    expect(src).toMatch(/const fetchKpis = useCallback/);
    const fetchBlock = src.slice(
      src.indexOf("const fetchKpis = useCallback"),
      src.indexOf("const fetchKpis = useCallback") + 1600
    );
    expect(fetchBlock).toMatch(/const session = sessionRef\.current/);
    expect(fetchBlock).toMatch(/reportsClient\.dashboard\(session,/);
    expect(fetchBlock).not.toMatch(/\[accessToken,\s*session\]/);
  });

  it("P1-B (duties): memoized loaders read session via sessionRef (no stale-auth closures)", () => {
    const src = readWeb("app/duties/page.tsx");
    expect(src).toMatch(/const sessionRef = useRef/);
    expect(src).toMatch(/const supabaseRef = useRef/);
    const loaders = [
      "const loadDiaryFor = useCallback",
      "const loadDiariesForVisible = useCallback",
      "const loadOutstanding = useCallback",
      "const loadTotals = useCallback",
      "const reload = useCallback"
    ];
    for (const marker of loaders) {
      const start = src.indexOf(marker);
      expect(start, `missing ${marker}`).toBeGreaterThan(-1);
      const block = src.slice(start, start + 1400);
      expect(block, `${marker} must use sessionRef.current`).toMatch(/sessionRef\.current/);
      expect(block, `${marker} must not call sessionOrNull(auth)`).not.toMatch(
        /sessionOrNull\(auth\)/
      );
    }
    const realtime = src.slice(
      src.indexOf('channel("crm-hh_duties_calendar")'),
      src.indexOf('channel("crm-hh_duties_calendar")') + 800
    );
    expect(realtime).toMatch(/supabaseRef\.current/);
    expect(realtime).not.toMatch(/auth\.supabase\.channel/);
  });

  it("P1-B (attendance): mark/update/delete send expected_updated_at and handle conflict UI", () => {
    const service = readWeb("src/services/attendanceService.ts");
    expect(service).toMatch(/assertNotStale/);
    expect(service).toMatch(/expected_updated_at/);
    const validation = readWeb("src/validation/attendanceValidation.ts");
    expect(validation).toMatch(/expected_updated_at/);
    const page = readWeb("app/attendance/page.tsx");
    expect(page).toMatch(/expectedUpdatedAt/);
    expect(page).toMatch(/conflictPrompt/);
    expect(page).toMatch(/reloadAttendanceFromConflict/);
    const smoke = readWeb("src/integration/__tests__/attendanceModule.smoke.test.ts");
    expect(smoke).toMatch(/AttendanceMarkPost/);
    expect(smoke).toMatch(/409.*conflict/s);
  });

  it("P1-B (attendance): loaders read auth.session via sessionRef (no stale-auth closures inside hooks)", () => {
    const src = readWeb("app/attendance/page.tsx");
    // sessionRef pattern — pin session in a ref so memoized hooks never close
    // over a stale `auth` object identity after onAuthStateChange fires.
    expect(src).toMatch(/const sessionRef = useRef\(auth\.session/);
    expect(src).toMatch(/sessionRef\.current = auth\.session/);
    // The three loaders that previously read `auth` directly must now be
    // memoized with useCallback and pull the session out of sessionRef.
    expect(src).toMatch(/const loadBoard = useCallback/);
    expect(src).toMatch(/const reload = useCallback/);
    expect(src).toMatch(/const loadMissing = useCallback/);
    // No `sessionOrNull(auth)` inside the memoized loader bodies — those calls
    // are the original stale-auth defect surface. They are only allowed inside
    // event handlers (which re-capture auth on every render).
    const loaderBlock = src.slice(
      src.indexOf("const loadBoard = useCallback"),
      src.indexOf("// Refresh the day board")
    );
    expect(loaderBlock).not.toMatch(/sessionOrNull\(auth\)/);
    const reloadBlock = src.slice(
      src.indexOf("const reload = useCallback"),
      src.indexOf("const reload = useCallback") + 1200
    );
    expect(reloadBlock).not.toMatch(/sessionOrNull\(auth\)/);
    const missingBlock = src.slice(
      src.indexOf("const loadMissing = useCallback"),
      src.indexOf("const loadMissing = useCallback") + 1200
    );
    expect(missingBlock).not.toMatch(/sessionOrNull\(auth\)/);
    const realtime = src.slice(
      src.indexOf("// Refresh the day board"),
      src.indexOf("// Refresh the day board") + 900
    );
    expect(realtime).toMatch(/const supabase = supabaseRef\.current/);
    expect(realtime).not.toMatch(/auth\.supabase\.channel/);
  });

  it("P2-12: CI gates vercel-web on npm audit --audit-level=high (vitest 4.1+)", () => {
    const wf = readRepo(".github/workflows/audit-gate.yml");
    expect(wf).toMatch(/npm audit --audit-level=high/);
    expect(wf).toMatch(/working-directory:\s*vercel-web/);
    const pkg = readWeb("package.json");
    expect(pkg).toMatch(/"audit:high":\s*"npm audit --audit-level=high"/);
    expect(pkg).toMatch(/"vitest":\s*"\^4\.1\./);
    const lock = readWeb("package-lock.json");
    expect(lock).toMatch(/"node_modules\/vitest"/);
    expect(lock).toMatch(/"version": "4\.1\./);
  });

  it("P2-11: catalog/financial tables split FOR ALL RLS into SELECT + role writes", async () => {
    const mig = readAllMigrations();
    const staticOk =
      /hh_doctors_select/.test(mig) &&
      /hh_vendors_select/.test(mig) &&
      /hh_roles_select/.test(mig) &&
      /hh_paid_transactions_select/.test(mig) &&
      /hh_svc_entries_select/.test(mig) &&
      /hh_counters_select/.test(mig) &&
      /hh_ai_conversations_select/.test(mig) &&
      /hh_ai_messages_select/.test(mig) &&
      /drop policy if exists hh_doctors_authenticated_access/.test(mig) &&
      /audit_probe_p2_11_ok/.test(mig);
    const ok = await auditProbeOk("audit_probe_p2_11_ok", () => staticOk);
    expect(
      ok,
      "P2-11 tables still have blanket FOR ALL hh_is_active_app_user policies or missing split policies"
    ).toBe(true);
  });

  it("P2-10: document-card Remove confirms before onRemove", () => {
    const card = readWeb("components/ui/document-card.tsx");
    expect(card).toMatch(/useConfirm/);
    expect(card).toMatch(/handleRemoveClick/);
    expect(card).toMatch(/Remove this document\?/);
    expect(card).not.toMatch(/onClick=\{onRemove\}/);
  });

  it("P2-9: employees form wires fieldErrors to aria-invalid + inline hints", () => {
    const employees = readWeb("app/employees/page.tsx");
    expect(employees).toMatch(/ValidatedInput/);
    expect(employees).toMatch(/ValidatedSelect/);
    expect(employees).toMatch(/ValidatedTextarea/);
    expect(employees).toMatch(/parseValidationFieldErrors/);
    const fieldUi = readWeb("lib/fieldErrorsUi.tsx");
    expect(fieldUi).toMatch(/FieldInlineError/);
    expect(fieldUi).toMatch(/aria-invalid/);
    expect(fieldUi).toMatch(/aria-describedby/);
    expect(employees).toMatch(/aliasKeys=\{\["phone"\]\}/);
    expect(employees).not.toMatch(/Object\.entries\(fieldErrors\.fields/);

    expect(readWeb("lib/fieldErrorsUi.tsx")).toMatch(/fieldInputAriaProps/);
    expect(readWeb("lib/__tests__/fieldErrorsUi.test.ts")).toMatch(/P2-9/);
  });

  it("P2-8: cited date inputs carry min/max business-rule props", () => {
    const employees = readWeb("app/employees/page.tsx");
    expect(employees).toMatch(/employeeLeaveDateMin/);
    expect(employees).toMatch(/employees-leaving-date-24[\s\S]{0,220}min=\{employeeLeaveDateMin/);

    const inquiries = readWeb("app/inquiries/page.tsx");
    expect(inquiries).toMatch(/inquiryFollowupDateMin/);
    expect(inquiries).toMatch(/inquiries-follow-up-date-10[\s\S]{0,180}min=\{inquiryFollowupDateMin/);
    expect(inquiries).toMatch(/inquiries-follow-up-date-20[\s\S]{0,180}min=\{inquiryFollowupDateMin/);

    const billings = readWeb("app/billings/page.tsx");
    expect(billings).toMatch(/ledgerBackdatedDateMax/);
    expect(billings).toMatch(/billings-date-8[\s\S]{0,180}max=\{ledgerBackdatedDateMax/);
    expect(billings).toMatch(/billings-date-20[\s\S]{0,180}max=\{ledgerBackdatedDateMax/);

    const patients = readWeb("app/patients/page.tsx");
    expect(patients).toMatch(/patientStartDateMax/);
    expect(patients).toMatch(/patients-start-date-8[\s\S]{0,180}max=\{patientStartDateMax/);

    expect(readWeb("lib/dateFieldBounds.ts")).toMatch(/employeeLeaveDateMin/);
    expect(readWeb("lib/__tests__/dateFieldBounds.test.ts")).toMatch(/P2-8/);
  });

  it("P2-7: duties/inquiries/attendance/patients status NOT NULL + CHECK", async () => {
    const mig = readAllMigrations();
    const staticOk =
      /chk_hh_duties_status/.test(mig) &&
      /chk_hh_inquiries_status/.test(mig) &&
      /chk_hh_attendance_status/.test(mig) &&
      /chk_hh_patients_status/.test(mig) &&
      /audit_probe_p2_7_ok/.test(mig);
    const ok = await auditProbeOk("audit_probe_p2_7_ok", () => staticOk);
    expect(
      ok,
      "hh_duties/hh_inquiries/hh_attendance/hh_patients.status missing NOT NULL or CHECK constraint"
    ).toBe(true);
  });

  it("P2-6: doctors/vendors/users enforce optimistic locking end-to-end", () => {
    for (const servicePath of [
      "src/services/doctorService.ts",
      "src/services/vendorService.ts",
      "src/services/userService.ts"
    ]) {
      const service = readWeb(servicePath);
      expect(service).toMatch(/assertNotStale/);
      expect(service).toMatch(/requireExpectedVersion/);
      expect(service).toMatch(/expected_updated_at/);
    }
    expect(readWeb("src/validation/doctorValidation.ts")).toMatch(/expected_updated_at/);
    expect(readWeb("src/validation/vendorValidation.ts")).toMatch(/expected_updated_at/);
    expect(readWeb("src/validation/userValidation.ts")).toMatch(/expected_updated_at/);

    for (const page of ["app/doctors/page.tsx", "app/vendors/page.tsx", "app/users/page.tsx"]) {
      const src = readWeb(page);
      expect(src).toMatch(/expected_updated_at/);
      expect(src).toMatch(/conflictPrompt/);
      expect(src).toMatch(/Reload latest/);
    }

    expect(readWeb("lib/clients/doctorsClient.ts")).toMatch(/\bget\(/);
    expect(readWeb("lib/clients/vendorsClient.ts")).toMatch(/\bget\(/);
    expect(readWeb("lib/clients/usersClient.ts")).toMatch(/\bget\(/);

    const catalogTests = readWeb("src/services/__tests__/catalogConcurrency.test.ts");
    expect(catalogTests).toMatch(/doctorService/);
    expect(catalogTests).toMatch(/vendorService/);
    expect(catalogTests).toMatch(/userService/);
    expect(catalogTests).toMatch(/conflict/);
  });

  it("R6: audit_checks readWeb resolves .js paths to .tsx/.ts sources", () => {
    expect(readWeb("app/layout.js")).toMatch(/export const viewport/);
    expect(readWeb("lib/api-client.js")).toMatch(/Idempotency-Key/);
    expect(readWeb("hooks/use-realtime-resource.js")).toMatch(/useRealtimeResource/);
  });

  it("R5: hh_idempotency server-only + HIBP runbook and client password policy", () => {
    const migration = readWeb(
      "supabase/migrations/20260601230000_r5_idempotency_auth_hardening.sql"
    );
    expect(migration).toMatch(/drop policy if exists hh_idempotency_authenticated_access/i);
    expect(migration).toMatch(/to service_role/i);
    expect(migration).toMatch(/revoke all on table public\.hh_idempotency from authenticated/i);
    expect(migration).toMatch(/grant select, insert, update, delete on table public\.hh_idempotency to service_role/i);

    const repo = readWeb("src/database/idempotencyRepository.ts");
    expect(repo).toMatch(/adminClient\(\)/);
    expect(repo).not.toMatch(/userClient\(/);

    const reset = readWeb("app/reset-password/page.tsx");
    expect(reset).toMatch(/password\.length < 12/);
    expect(reset).toMatch(/breach/i);

    const ops = readWeb("OPS.md");
    expect(ops).toMatch(/Leaked password protection/i);
    expect(ops).toMatch(/verify-auth-hibp/);
  });

  it("R4: realtime subscriptions use supabaseRef (hook + billings)", () => {
    const hook = readWeb("hooks/use-realtime-resource.ts");
    expect(hook).toMatch(/const supabaseRef = useRef/);
    expect(hook).toMatch(/supabaseRef\.current = auth\.supabase/);
    const channelBlock = hook.slice(
      hook.indexOf("const supabase = supabaseRef.current"),
      hook.indexOf("channel.subscribe();") + 40
    );
    expect(channelBlock).toMatch(/supabase\.channel\("crm-" \+ channelName\)/);
    expect(channelBlock).not.toMatch(/auth\.supabase\.channel/);
    const rtDeps = hook.slice(
      hook.indexOf("[accessToken, channelName, tablesKey, fetchOnce]"),
      hook.indexOf("[accessToken, channelName, tablesKey, fetchOnce]") + 60
    );
    expect(rtDeps).not.toMatch(/auth\.supabase/);

    const billings = readWeb("app/billings/page.tsx");
    expect(billings).toMatch(/const supabaseRef = useRef/);
    const billingRt = billings.slice(
      billings.indexOf('channel("crm-billing-ledger")') - 200,
      billings.indexOf('channel("crm-billing-ledger")') + 400
    );
    expect(billingRt).toMatch(/const supabase = supabaseRef\.current/);
    expect(billingRt).not.toMatch(/auth\.supabase\.channel/);
  });

  it("R3: audit triggers on six core tables (duties, attendance, payouts, patients, employees, inquiries)", () => {
    const migration = readWeb(
      "supabase/migrations/20260601220000_audit_triggers_core_modules.sql"
    );
    expect(migration).toMatch(/create or replace function public\.hh_audit_trigger\(\)/);
    for (const table of [
      "hh_duties",
      "hh_attendance",
      "hh_payouts",
      "hh_patients",
      "hh_employees",
      "hh_inquiries"
    ]) {
      expect(migration).toMatch(new RegExp(`'${table}'`));
    }
    expect(migration).toMatch(/'trg_audit_' \|\| cfg\.table_name/);
    expect(migration).toMatch(/'duty'/);
    expect(migration).toMatch(/'attendance'/);
    expect(migration).toMatch(/'payout'/);
    expect(migration).toMatch(/'patient'/);
    expect(migration).toMatch(/'employee'/);
    expect(migration).toMatch(/'inquiry'/);
  });

  it("R2: business RPCs use service-role client; migration revokes authenticated EXECUTE", () => {
    const migration = readWeb(
      "supabase/migrations/20260601210000_revoke_authenticated_business_rpc.sql"
    );
    expect(migration).toMatch(/revoke execute on function/i);
    expect(migration).toMatch(/from authenticated/i);
    expect(migration).toMatch(/grant execute on function/i);
    expect(migration).toMatch(/to service_role/i);
    expect(migration).toMatch(/hh_idempotency_service/);

    const clients = readWeb("src/database/clients.ts");
    expect(clients).toMatch(/supabaseRpcAsService/);
    expect(clients).toMatch(/Authorization.*accessToken/s);

    const base = readWeb("src/database/baseRepository.ts");
    const callRpcBlock = base.slice(
      base.indexOf("export async function callRpc"),
      base.indexOf("export async function countWhere")
    );
    expect(callRpcBlock).toMatch(/rpcClient\(opts\?\.accessToken\)/);
    expect(callRpcBlock).not.toMatch(/resolveClient/);
  });

  it("P1-G: page modals use ModalDialog (focus trap, Escape, onMouseDown backdrop)", () => {
    const files = [
      "app/duties/page.tsx",
      "app/employees/page.tsx",
      "app/inquiries/page.tsx",
      "app/patients/page.tsx",
      "app/billings/page.tsx"
    ];
    const offenders: string[] = [];
    for (const f of files) {
      const src = readWeb(f);
      if (!/ModalDialog/.test(src)) {
        offenders.push(`${f}: missing ModalDialog import/usage`);
        continue;
      }
      if (/className="modal-backdrop"/.test(src)) {
        offenders.push(`${f}: still renders modal-backdrop directly — use ModalDialog`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("P1-52: lib/csv prepends BOM and escapes formula-injection-prone leading characters", () => {
    const src = readWebResolved("lib/csv.js");
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
      const src = readWebResolved(f);
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

  /**
   * P1-69 (field bug, 2026-06-02): "31 days in duty calendar but billing
   * shows 27 days" — operator-reported mismatch caused by the nightly
   * `cron/duties-extend` lagging behind the duty calendar view. Two
   * complementary fixes are now in place; this audit pins both so they
   * never silently regress:
   *
   *   1. `lib/dutyUi.ts::dutyTouchesDay` MUST cap open-ended duties to
   *      today so the calendar never paints cells past the materialize
   *      horizon (`effectiveMaterializeEndAt` in
   *      `src/business/dutyRules.ts`).
   *   2. `billingService.getById` MUST invoke
   *      `dutyService.extendForPatient` on each Active bill read, so the
   *      ledger lazily backfills missing svc_entries when the cron is
   *      delayed.
   */
  it("P1-69: duty calendar ↔ billing parity (sync + dedup effective end)", () => {
    const dutyUi = readWeb("lib/dutyUi.ts");
    expect(
      /isOpenEndedIso\(row\.end_at\)\s*\?\s*today\s*:\s*rawEnd/.test(dutyUi),
      "lib/dutyUi.ts::dutyTouchesDay must cap open-ended duties at today"
    ).toBe(true);

    const dutyRepo = readWeb("src/database/dutyRepository.ts");
    expect(
      /findMaterializableByPatient/.test(dutyRepo),
      "dutyRepository must list all non-cancelled duties for patient-scoped backfill (includes COMPLETED)"
    ).toBe(true);

    const dutyService = readWeb("src/services/dutyService.ts");
    expect(
      /findMaterializableByPatient\s*\(\s*pid/.test(dutyService),
      "extendForPatient must use findMaterializableByPatient, not findActiveByPatient"
    ).toBe(true);

    const billingService = readWeb("src/services/billingService.ts");
    expect(
      /syncDutyLedgerForPatient/.test(billingService),
      "billingService must expose syncDutyLedgerForPatient (materialize + dedup)"
    ).toBe(true);
    expect(
      /dedupBillingDiaryRpc/.test(billingService),
      "syncDutyLedgerForPatient must run hominal_dedup_billing_diary after materialize"
    ).toBe(true);

    const migrations = readAllMigrations();
    expect(
      /least\s*\(\s*\(d\.end_at at time zone 'Asia\/Kolkata'\)::date,\s*v_today_ist\s*\)/.test(migrations),
      "hominal_dedup_billing_diary must cap phantom upper bound to LEAST(duty end IST, today IST)"
    ).toBe(true);

    expect(
      existsWeb("app/api/v1/billings/duty-ledger-sync/route.ts"),
      "POST /api/v1/billings/duty-ledger-sync route must exist for calendar-triggered sync"
    ).toBe(true);

    const dutiesPage = readWeb("app/duties/page.tsx");
    expect(
      /billingsClient\.syncDutyLedger/.test(dutiesPage),
      "duty calendar must call billingsClient.syncDutyLedger when a patient filter is active"
    ).toBe(true);
  });
});
