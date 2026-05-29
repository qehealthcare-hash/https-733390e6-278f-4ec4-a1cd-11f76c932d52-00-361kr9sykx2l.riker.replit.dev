import { describe, it, expect } from "vitest";
import { readWeb, count, existsWeb, appPages, sqlSelect, rpcAuditProbeOk } from "./helpers";

describe("P1 — Broken core flow, soon-to-be incident", () => {
  // ──────────────────────────────────────────────────────────────────────────
  // Frontend / hooks
  // ──────────────────────────────────────────────────────────────────────────

  it("P1-1: use-realtime-resource.js checks cancelled before each setState in fetchOnce", () => {
    const src = readWeb("hooks/use-realtime-resource.js");
    // fetchOnce should guard every setData/setTotal/setError with a cancelled check
    // (either by `if (cancelled.current) return` lines or an AbortController.signal.aborted check).
    const guarded =
      /(cancelled\.current|signal\.aborted)/.test(src) &&
      /if\s*\(\s*(cancelled\.current|signal\.aborted)/.test(src);
    expect(guarded, "fetchOnce does not short-circuit on cancelled/aborted before setX").toBe(true);
  });

  it("P1-2: openPayout in payouts-inner.js uses a request-token guard before setX", () => {
    const src = readWeb("app/payouts/payouts-inner.js");
    const hasToken =
      /openPayoutSeq|reqId|requestId|seqRef/.test(src) &&
      /if\s*\(\s*reqId\s*!==/.test(src);
    expect(hasToken, "openPayout has no request-token guard").toBe(true);
  });

  it("P1-3: auth-provider.js registers online + visibilitychange listeners and 5xx enqueues", () => {
    const ap = readWeb("components/providers/auth-provider.js");
    const hasOnline = /addEventListener\(\s*['"]online['"]/.test(ap);
    const hasVis = /addEventListener\(\s*['"]visibilitychange['"]/.test(ap);
    expect(hasOnline && hasVis, "auth-provider.js missing window 'online' or 'visibilitychange' listeners").toBe(true);
    const client = readWeb("lib/api-client.js");
    const enqueues5xx = /(status\s*>=\s*500|enqueue.*5xx|retry.*5xx)/i.test(client);
    expect(enqueues5xx, "lib/api-client.js does not enqueue on 5xx / transient failure").toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Database / schema
  // ──────────────────────────────────────────────────────────────────────────

  it("P1-4: financial FKs are ON DELETE RESTRICT (hh_receipts/invoices/svc_entries.billing_id, hh_attendance.duty_id)", async () => {
    const ok = await rpcAuditProbeOk("audit_probe_p1_4_ok");
    expect(ok, "One or more financial FKs are not ON DELETE RESTRICT").toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Client-side validation
  // ──────────────────────────────────────────────────────────────────────────

  it("P1-5: Aadhar / PAN / phone / DOB inputs use pattern / inputMode / max={today}", () => {
    const aadharOk = (src: string) =>
      /aadhar/i.test(src) && (/pattern=\\?"\\\\d\{12\}\\?"|inputMode=\\?"numeric\\?"/.test(src));
    const panOk = (src: string) =>
      /pan/i.test(src) && /pattern=.{0,40}\[A-Z\]\{5\}\\d\{4\}\[A-Z\]/.test(src);
    const phoneOk = (src: string) => /type=\\?"tel\\?"|inputMode=\\?"tel\\?"/.test(src);
    const dobOk = (src: string) => /(max=\{today|todayIso|crmTodayIso\(\))/.test(src);

    const targets = [
      ["app/employees/page.js", { aadhar: true, pan: true, phone: true, dob: true }],
      ["app/patients/page.js", { aadhar: true, pan: false, phone: true, dob: true }],
      ["app/doctors/page.js", { aadhar: false, pan: false, phone: true, dob: true }],
      ["app/inquiries/page.js", { aadhar: false, pan: false, phone: true, dob: false }],
      ["app/users/page.js", { aadhar: false, pan: false, phone: true, dob: false }]
    ] as const;

    const missing: string[] = [];
    for (const [path, req] of targets) {
      const src = readWeb(path);
      if (req.aadhar && !aadharOk(src)) missing.push(`${path}: Aadhar pattern missing`);
      if (req.pan && !panOk(src)) missing.push(`${path}: PAN pattern missing`);
      if (req.phone && !phoneOk(src)) missing.push(`${path}: phone type=tel/inputMode=tel missing`);
      if (req.dob && !dobOk(src)) missing.push(`${path}: DOB max={today} missing`);
    }
    expect(missing, `Client-side format validation gaps:\n${missing.join("\n")}`).toEqual([]);
  });

  it("P1-6: app/layout.js exports viewport with width: device-width", () => {
    const layout = readWeb("app/layout.js");
    const ok = /export\s+const\s+viewport\s*=\s*\{[\s\S]{0,200}width:\s*['"]device-width['"]/.test(layout);
    expect(ok, "app/layout.js missing `export const viewport = { width: 'device-width', … }`").toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Legacy iframe + CSP
  // ──────────────────────────────────────────────────────────────────────────

  it("P1-7: legacy-crm.html no longer concatenates user fields into innerHTML at cited rows", () => {
    const html = readWeb("public/legacy-crm.html");
    // Cited lines do `row.innerHTML = '<td>'+p.name+'</td>...'` style concat. After fix, every
    // such concat must be replaced with safeText() / textContent / a builder helper.
    // Approximate fingerprint: any line that contains `.innerHTML` followed by a `+` and
    // a property access (`+ p.` / `+ row.` / `+ u.` / `+ e.` / `+ b.` / `+ i.`).
    const dangerous = /\.innerHTML\s*=[^;]*\+\s*[a-zA-Z_$][\w$]*\.[a-zA-Z_$][\w$]*/g;
    const n = (html.match(dangerous) || []).length;
    expect(n, `legacy-crm.html still has ${n} dangerous innerHTML+user-field concatenations`).toBe(0);
  });

  it("P1-8: next.config.mjs CSP script-src does not contain 'unsafe-eval'", () => {
    const cfg = readWeb("next.config.mjs");
    // Find the CSP value string and inspect script-src segment.
    const m = cfg.match(/Content-Security-Policy["'\s]*[,]\s*value\s*:\s*\[([\s\S]*?)\]\.join/);
    expect(m, "CSP value array not found in next.config.mjs").not.toBeNull();
    const cspSrc = (m ? m[1] : cfg).toLowerCase();
    expect(/'unsafe-eval'/i.test(cspSrc), "CSP script-src still contains 'unsafe-eval'").toBe(false);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Cron / service-role
  // ──────────────────────────────────────────────────────────────────────────

  it("P1-9: cron actor uses a real service-account JWT (non-empty accessToken)", () => {
    const src = readWeb("app/api/v1/cron/duties-extend/route.ts");
    // The current synthetic actor sets accessToken: "". After fix, the cron must
    // either mint a real JWT (e.g. signed Service Account token) or call a
    // dedicated service-role-with-context RPC. Heuristic: forbid accessToken: ""
    // in the synthesized actor block.
    const stillEmpty = /accessToken\s*:\s*["']\s*["']/.test(src);
    expect(stillEmpty, "cron actor still uses an empty `accessToken: \"\"` synthetic JWT").toBe(false);
  });

  it("P1-10: rate limiter is backed by KV/Upstash and a /api/v1/auth/login proxy exists with enforceRateLimit", () => {
    const sec = readWeb("lib/api/security.ts");
    const persistent = /(Redis|Upstash|@vercel\/kv|kv\.|@upstash)/i.test(sec);
    expect(persistent, "lib/api/security.ts rate-limit is still in-memory (no KV/Upstash backend)").toBe(true);
    const hasLoginProxy = existsWeb("app/api/v1/auth/login/route.ts");
    expect(hasLoginProxy, "missing /api/v1/auth/login server-side proxy route").toBe(true);
    if (hasLoginProxy) {
      const src = readWeb("app/api/v1/auth/login/route.ts");
      const rate = /enforceRateLimit\([^)]{0,80}["']login["']\s*,\s*5\s*,\s*60_000\)/.test(src);
      expect(rate, "/api/v1/auth/login does not call enforceRateLimit(req, 'login', 5, 60_000)").toBe(true);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Postgres function bodies
  // ──────────────────────────────────────────────────────────────────────────

  it("P1-11: hh_recompute_payout body contains row-lock (FOR UPDATE or pg_advisory_xact_lock)", async () => {
    const ok = await rpcAuditProbeOk("audit_probe_p1_11_ok");
    expect(ok, "hh_recompute_payout body has no FOR UPDATE / advisory lock").toBe(true);
  });

  it("P1-12: hh_convert_inquiry_to_patient body has FOR UPDATE and no random() id generation", async () => {
    const ok = await rpcAuditProbeOk("audit_probe_p1_12_ok");
    expect(ok, "hh_convert_inquiry_to_patient missing FOR UPDATE or still uses random() id").toBe(true);
  });

  it("P1-13: hh_billings.status and hh_payouts.status are NOT NULL with CHECK constraints", async () => {
    const ok = await rpcAuditProbeOk("audit_probe_p1_13_ok");
    expect(ok, "hh_billings/hh_payouts.status missing NOT NULL or CHECK constraint").toBe(true);
  });

  it("P1-14: hh_lookup_login returns a single boolean and is not granted to authenticated", async () => {
    // The probe RPC encapsulates the pg_proc inspection so the test can run
    // with an anon key. It returns true iff the function:
    //   * returns `boolean`
    //   * has no `authenticated=…` entry in proacl
    const ok = await rpcAuditProbeOk("audit_probe_p1_14_ok");
    expect(ok, "hh_lookup_login is not boolean or still granted to authenticated").toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // WhatsApp / cron-driven mass mutations
  // ──────────────────────────────────────────────────────────────────────────

  it("P1-15: whatsapp send routes require Admin/Manager AND constrain `to` + `invoice_url`", () => {
    const checkRoute = (path: string) => {
      try {
        const src = readWeb(path);
        return /requireRole\s*\(\s*actor\s*,\s*\[[^\]]*Admin[^\]]*Manager[^\]]*\]/.test(src);
      } catch {
        return false;
      }
    };
    const a = checkRoute("app/api/v1/whatsapp/send/route.ts");
    const b = checkRoute("app/api/v1/whatsapp/send-bill/route.ts");
    const c = checkRoute("app/api/v1/whatsapp/send-template/route.ts");
    expect(a && b && c, "one or more WhatsApp send routes missing requireRole([Admin,Manager])").toBe(true);

    const val = readWeb("src/validation/whatsappValidation.ts");
    const toPrefix = /\+\?\?91|prefix|countryPrefix|WHATSAPP_PHONE_PREFIX/i.test(val);
    const urlAllowList = /(z\.string\(\)\.url\(\)\.refine|ORG_HOSTS|allowedHosts|invoiceUrlSchema)/.test(val);
    expect(toPrefix, "whatsappValidation: `to` not constrained to a country prefix").toBe(true);
    expect(urlAllowList, "whatsappValidation: `invoice_url` not constrained to an allow-list").toBe(true);
  });

  it("P1-16: duties/extend-active requires Admin/Manager and has a per-hour cooldown", () => {
    const src = readWeb("app/api/v1/duties/extend-active/route.ts");
    const role = /requireRole\s*\(\s*actor\s*,\s*\[[^\]]*Admin[^\]]*Manager[^\]]*\]/.test(src);
    const cooldown =
      /(idempotencyKey.*hour|cooldown|withIdempotency\s*\([\s\S]{0,80}ttlMs\s*:\s*60\s*\*\s*60\s*\*\s*1000)/i.test(src);
    expect(role, "extend-active route missing requireRole([Admin,Manager])").toBe(true);
    expect(cooldown, "extend-active route missing 1-hour cooldown / idempotency window").toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Forms / formats / atomicity
  // ──────────────────────────────────────────────────────────────────────────

  it("P1-17: payouts period_month input is type=\"month\" and validated against YYYY-MM regex", () => {
    const src = readWeb("app/payouts/payouts-inner.js");
    const typeMonth = /type=\\?"month\\?"/.test(src) || /type=['"]month['"]/.test(src);
    const regexed = /\^\\d\{4\}-\(0\[1-9\]\|1\[0-2\]\)\$/.test(src);
    expect(typeMonth, "period_month input is not type=\"month\"").toBe(true);
    expect(regexed, "period_month not validated against /^\\d{4}-(0[1-9]|1[0-2])$/").toBe(true);
  });

  it("P1-18: billingService.recordPayment uses a single hominal_save_receipt_v2 RPC", () => {
    const src = readWeb("src/services/billingService.ts");
    const usesV2 = /hominal_save_receipt_v2/.test(src);
    const oldFlow =
      /(nextReceiptNoRpc\s*\(|stamp\w*ReceiptNo|recomputePaidStatus\s*\([\s\S]{0,400}saveReceiptRpc)/.test(src);
    expect(usesV2, "billingService.recordPayment does not call hominal_save_receipt_v2").toBe(true);
    expect(oldFlow, "billingService.recordPayment still does the multi-step non-atomic flow").toBe(false);
  });

  it("P1-19: billingService.generateFromDutyRange uses a single hominal_generate_from_duty_range RPC", () => {
    const src = readWeb("src/services/billingService.ts");
    const usesRpc = /hominal_generate_from_duty_range/.test(src);
    expect(usesRpc, "billingService.generateFromDutyRange does not call hominal_generate_from_duty_range").toBe(true);
  });

  it("P1-20: end-of-month query in duties page uses IST offset (+05:30)", () => {
    const src = readWeb("app/duties/page.js");
    // Look for an end-of-month bound built without IST offset → flag.
    const naive = /T23:59:59\.999Z/.test(src);
    const istOffset = /\+05:30/.test(src) || /endOfMonthIst|istEndOfMonth|crmEndOfMonth/.test(src);
    expect(istOffset, "duties page end-of-month not built with +05:30 offset / IST helper").toBe(true);
    expect(naive, "duties page still uses naive T23:59:59.999Z (UTC) end-of-month bound").toBe(false);
  });

  it("P1-21: no `new Date().toISOString().slice(0,10)` remains in src/", () => {
    const files = [
      "src/business/employeeRules.ts",
      "src/services/employeeService.ts",
      "src/services/userService.ts",
      "src/services/storageService.ts",
      "src/services/aiService.ts"
    ];
    const bad: string[] = [];
    for (const f of files) {
      const src = readWeb(f);
      if (/new\s+Date\(\)\.toISOString\(\)\.slice\(\s*0\s*,\s*10\s*\)/.test(src)) bad.push(f);
    }
    expect(bad, `Files still using UTC slice(0,10):\n${bad.join("\n")}`).toEqual([]);
  });

  it("P1-22: userService rejects role=Admin from a non-Admin actor", () => {
    const src = readWeb("src/services/userService.ts");
    const guarded =
      /(actor\.role[\s\S]{0,40}!==\s*['"]Admin['"][\s\S]{0,200}role[\s\S]{0,40}===\s*['"]Admin['"])/i.test(src) ||
      /forbiddenElevate|requireAdminToMintAdmin|RoleElevationDenied/.test(src);
    expect(guarded, "userService does not refuse Manager elevation to Admin").toBe(true);
  });

  it("P1-23: created / created_by are assigned server-side, never from request body", () => {
    const inquiry = readWeb("src/services/inquiryService.ts");
    const user = readWeb("src/services/userService.ts");
    const inquiryBad = /created\s*:\s*input\.created/.test(inquiry);
    const userBad = /created\s*:\s*input\.created/.test(user);
    expect(inquiryBad, "inquiryService still uses `created: input.created`").toBe(false);
    expect(userBad, "userService still uses `created: input.created`").toBe(false);
  });

  it("P1-24: whatsapp webhook validates payload with whatsappWebhookPayloadSchema", () => {
    const route = readWeb("app/api/v1/whatsapp/webhook/route.ts");
    const val = readWeb("src/validation/whatsappValidation.ts");
    const routeUses = /whatsappWebhookPayloadSchema/.test(route);
    const schemaExists = /whatsappWebhookPayloadSchema/.test(val);
    expect(schemaExists, "whatsappWebhookPayloadSchema not defined in src/validation/whatsappValidation.ts").toBe(true);
    expect(routeUses, "webhook route does not validate body with whatsappWebhookPayloadSchema").toBe(true);
  });

  it("P1-25: dutyService bill listings use batched listSvcByBillingIds / listActiveReceiptsByBillingIds", () => {
    const src = readWeb("src/services/dutyService.ts");
    const usesBatched =
      /listSvcByBillingIds\s*\(/.test(src) && /listActiveReceiptsByBillingIds\s*\(/.test(src);
    const stillN1 = /for\s*\([^)]*of\s+billRows[^)]*\)\s*\{[\s\S]{0,400}await\s+listSvc\s*\(/.test(src);
    expect(usesBatched, "dutyService does not use the batched listSvcByBillingIds + listActiveReceiptsByBillingIds helpers").toBe(true);
    expect(stillN1, "dutyService still has the per-billing N+1 loop").toBe(false);
  });

  it("P1-26: isoDate schema enforces a strict YYYY-MM-DD regex", () => {
    const src = readWeb("src/validation/commonValidation.ts");
    const strict = /isoDate[\s\S]{0,200}regex\(\s*\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}/.test(src);
    expect(strict, "isoDate is still `refine(Date.parse)` rather than a strict regex").toBe(true);
  });

  it("P1-27: realtime effects depend on auth.session?.access_token, not the full session object", () => {
    const files = [
      "app/billings/page.js",
      "app/payouts/payouts-inner.js",
      "app/duties/page.js",
      "app/attendance/page.js"
    ];
    const bad: string[] = [];
    for (const f of files) {
      let src: string;
      try {
        src = readWeb(f);
      } catch {
        continue; // file may not exist; skip
      }
      // Match each supabase.channel(...) block up to its enclosing useEffect closer `}, [DEPS]);`
      // and inspect ONLY the deps array. Non-greedy 4 KB cap so we don't run away.
      const re = /supabase\.channel\([\s\S]{0,4000}?\}\s*,\s*\[([^\]]*)\]\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const deps = m[1];
        const bareSession = /\bauth\.session\b/.test(deps) && !/auth\.session\?\.access_token/.test(deps);
        if (bareSession) {
          bad.push(`${f}: deps=[${deps.trim()}]`);
          break;
        }
      }
    }
    expect(bad, `Realtime effects still depend on full session:\n${bad.join("\n")}`).toEqual([]);
  });

  it("P1-28: capped list pages show 'Showing first N of M' banner when rows.length === limit", () => {
    const files = ["app/billings/page.js", "app/payouts/payouts-inner.js", "app/duties/page.js"];
    const missing: string[] = [];
    for (const f of files) {
      const src = readWeb(f);
      if (!/Showing\s+first\s+|refine\s+filters|truncat/i.test(src)) missing.push(f);
    }
    expect(missing, `Pages missing capped-list banner:\n${missing.join("\n")}`).toEqual([]);
  });

  it("P1-29: payouts-inner.js revokes proof Object URLs (revokeObjectURL)", () => {
    const src = readWeb("app/payouts/payouts-inner.js");
    const revokes = /URL\.revokeObjectURL\s*\(/.test(src);
    expect(revokes, "payouts-inner.js never calls URL.revokeObjectURL on proof preview URLs").toBe(true);
  });

  it("P1-30: .modal-card has max-height: calc(100vh - 48px) AND overflow-y: auto", () => {
    const css = readWeb("app/globals.css");
    const m = css.match(/\.modal-card\s*\{([\s\S]*?)\}/);
    expect(m, ".modal-card block not found in app/globals.css").not.toBeNull();
    const block = (m ? m[1] : "").toLowerCase();
    const maxH = /max-height\s*:\s*calc\s*\(\s*100vh/.test(block);
    const ovY = /overflow-y\s*:\s*auto/.test(block);
    expect(maxH && ovY, ".modal-card missing max-height: calc(100vh - 48px) and overflow-y: auto").toBe(true);
  });

  it("P1-31: every <label> in app/**/page.js has htmlFor", () => {
    const offenders: string[] = [];
    for (const file of appPages()) {
      const src = require("node:fs").readFileSync(file, "utf8") as string;
      // Find every <label …> opening tag.
      const labels = src.match(/<label\b[^>]*>/g) || [];
      for (const l of labels) {
        if (!/\bhtmlFor=/.test(l)) {
          offenders.push(`${file.split("/vercel-web/")[1]} :: ${l.slice(0, 80)}`);
        }
      }
    }
    expect(offenders, `<label> without htmlFor:\n${offenders.slice(0, 20).join("\n")}\n(+${Math.max(0, offenders.length - 20)} more)`).toEqual([]);
  });

  it("P1-32: openEmployeePdf / openPatientPdf open about:blank synchronously before await", () => {
    // Fingerprint of the popup-blocker fix: a synchronous window.open("about:blank", "_blank")
    // is required before any await for signed-URL retrieval. We check the literal
    // marker in each page; it lands as part of the fix and is otherwise absent.
    const marker = /window\.open\s*\(\s*["']about:blank["']\s*,\s*["']_blank["']/;
    const emp = readWeb("app/employees/page.js");
    const pat = readWeb("app/patients/page.js");
    const missing: string[] = [];
    if (!marker.test(emp)) missing.push("app/employees/page.js");
    if (!marker.test(pat)) missing.push("app/patients/page.js");
    expect(missing, `PDF popup-blocker fix missing (no sync window.open(\"about:blank\")):\n${missing.join("\n")}`).toEqual([]);
  });

  it("P1-33: cited routes no longer use parseJsonBody(req).catch(() => ({}))", () => {
    const files = [
      "app/api/v1/duties/diary/batch/route.ts",
      "app/api/v1/duties/[id]/route.ts",
      "app/api/v1/inquiries/[id]/convert/route.ts",
      "app/api/v1/billings/[id]/receipts/[receiptId]/route.ts",
      "app/api/v1/duties/[id]/diary/[date]/route.ts"
    ];
    const offenders: string[] = [];
    for (const f of files) {
      try {
        const src = readWeb(f);
        if (/parseJsonBody\([^)]*\)\s*\.catch\s*\(\s*\(\s*\)\s*=>\s*\(\s*\{\s*\}\s*\)\s*\)/.test(src)) {
          offenders.push(f);
        }
      } catch (e) {
        offenders.push(`${f} (${(e as Error).message})`);
      }
    }
    expect(offenders, `Routes still swallowing parse errors:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("P1-34: handler.ts errors out on empty body for routes that require one", () => {
    const src = readWeb("lib/api/handler.ts");
    // After fix: handler returns badRequest when text is empty AND a schema is in play.
    const guarded =
      /if\s*\(!text\)[\s\S]{0,80}(badRequest|throw\s+new\s+Error)/.test(src) ||
      /Body\s+required/i.test(src);
    const unconditionalReturnEmpty = /if\s*\(!text\)\s*return\s*\{\s*\}/.test(src);
    expect(guarded, "lib/api/handler.ts does not throw badRequest('Body required') on empty body").toBe(true);
    expect(unconditionalReturnEmpty, "lib/api/handler.ts still has `if (!text) return {} as T`").toBe(false);
  });

  it("P1-35: storageService.createSignedUpload validates MIME against an allow-list", () => {
    const src = readWeb("src/services/storageService.ts");
    const mimeEnum = /mime\s*:\s*z\.enum\s*\(/.test(src);
    const passedThrough = /createSignedUploadUrl\s*\(\s*\{[\s\S]{0,200}mime/.test(src);
    expect(mimeEnum, "storageService.createSignedUpload schema is missing `mime: z.enum([...])`").toBe(true);
    expect(passedThrough, "storageService.createSignedUpload does not pass mime to createSignedUploadUrl").toBe(true);
  });

  it("P1-36: storageService.createSignedUpload enforces isSafeObjectPath + per-resource prefix", () => {
    const src = readWeb("src/services/storageService.ts");
    // After fix the upload path must run through isSafeObjectPath (currently only the download does).
    const upUses = /createSignedUpload[\s\S]{0,800}isSafeObjectPath\s*\(/.test(src);
    const prefixEnforced = /(Patients\/|Employees\/|Invoices\/)/.test(src) && /startsWith\(/.test(src);
    expect(upUses, "createSignedUpload does not call isSafeObjectPath on the requested path").toBe(true);
    expect(prefixEnforced, "createSignedUpload does not enforce a per-resource path prefix (e.g. Patients/<id>/)").toBe(true);
  });

  it("P1-37: auth.ts uses .eq('email', email.toLowerCase()) — no .ilike on email", () => {
    const src = readWeb("lib/api/auth.ts");
    const stillIlike = /\.ilike\s*\(\s*["']email["']/.test(src);
    const usesEq = /\.eq\s*\(\s*["']email["']\s*,\s*[a-zA-Z_$][\w$]*\.toLowerCase\s*\(\s*\)/.test(src);
    expect(stillIlike, "lib/api/auth.ts still uses .ilike('email', …)").toBe(false);
    expect(usesEq, "lib/api/auth.ts does not use .eq('email', email.toLowerCase())").toBe(true);
  });

  it("P1-38: server-side /api/v1/auth/login proxy exists and rate-limits 5/60s", () => {
    const exists = existsWeb("app/api/v1/auth/login/route.ts");
    expect(exists, "missing app/api/v1/auth/login/route.ts (server-side login proxy)").toBe(true);
    if (exists) {
      const src = readWeb("app/api/v1/auth/login/route.ts");
      const rate = /enforceRateLimit\s*\(\s*[^,]+,\s*["']login["']\s*,\s*5\s*,\s*60_000\s*\)/.test(src);
      expect(rate, "login route does not call enforceRateLimit(req, 'login', 5, 60_000)").toBe(true);
    }
    // Browser must no longer call supabase.auth.signInWithPassword directly.
    const ap = readWeb("components/providers/auth-provider.js");
    const stillDirect = /supabase\.auth\.signInWithPassword\s*\(/.test(ap);
    expect(stillDirect, "auth-provider.js still calls supabase.auth.signInWithPassword directly from the browser").toBe(false);
  });
});
