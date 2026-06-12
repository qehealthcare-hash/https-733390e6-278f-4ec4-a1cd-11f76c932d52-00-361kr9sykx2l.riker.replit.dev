import { describe, it, expect } from "vitest";
import {
  readWeb,
  count,
  matches,
  getFunctionDef,
  probeRpcAsNurse,
  requireNurseJwt,
  requireSupabaseEnv,
  readAllMigrations
} from "./helpers";

function staticBusinessRpcRevokedFromAuthenticated(mig: string): boolean {
  return (
    /20260601210000_revoke_authenticated_business_rpc/.test(mig) &&
    /revoke execute[\s\S]{0,120}from authenticated/i.test(mig) &&
    /hominal_delete_invoice|hominal\_%/.test(mig)
  );
}

const DESTRUCTIVE_RPCS = [
  "hominal_delete_invoice",
  "hominal_flip_billing_status",
  "hominal_soft_delete_receipt",
  "hominal_save_receipt",
  "hh_recompute_payout",
  "hh_compact_invoice_seq",
  "hh_convert_inquiry_to_patient"
] as const;

describe("P0 — Data loss, auth bypass, breach", () => {
  it("P0-1: legacy-crm.html contains no 'admin123' literal", () => {
    const html = readWeb("public/legacy-crm.html");
    const n = count(html, /admin123/);
    expect(n, `Found ${n} occurrence(s) of 'admin123' in vercel-web/public/legacy-crm.html`).toBe(0);
  });

  it("P0-2: 7 destructive RPCs all require role (runtime probe → Nurse JWT must get 42501)", async () => {
    const mig = readAllMigrations();
    const staticR2 = staticBusinessRpcRevokedFromAuthenticated(mig);
    let jwt: string;
    try {
      requireSupabaseEnv();
      jwt = requireNurseJwt();
    } catch (e) {
      expect(
        staticR2,
        `P0-2 needs runtime probe (SUPABASE_URL, NURSE_JWT) or migration R2 in repo. (${(e as Error).message})`
      ).toBe(true);
      return;
    }
    const failures: string[] = [];
    for (const rpc of DESTRUCTIVE_RPCS) {
      const sampleArgs: Record<string, Record<string, unknown>> = {
        hominal_delete_invoice: { p_invoice_id: "AUDIT_PROBE", p_actor: "nurse@audit.probe" },
        hominal_flip_billing_status: {
          p_billing_id: "AUDIT_PROBE",
          p_target_status: "Active",
          p_actor: "nurse@audit.probe"
        },
        hominal_soft_delete_receipt: {
          p_receipt_id: "AUDIT_PROBE",
          p_billing_id: "AUDIT_PROBE",
          p_deleted_by: "nurse@audit.probe"
        },
        hominal_save_receipt: { p_receipt: { id: "AUDIT_PROBE" } },
        hh_recompute_payout: { p_employee_id: "AUDIT_PROBE", p_period: "2026-05" },
        hh_compact_invoice_seq: {},
        hh_convert_inquiry_to_patient: { p_inquiry_id: "AUDIT_PROBE" }
      };
      const { status, body } = await probeRpcAsNurse(rpc, sampleArgs[rpc] || {});
      // Pass: in-function role guard (42501) OR PostgREST EXECUTE denied after R2 migration.
      const ok =
        status >= 400 &&
        status < 500 &&
        (body.includes("42501") ||
          /forbidden|insufficient/i.test(body) ||
          /permission denied for function|not authorized to execute function/i.test(body));
      if (!ok) failures.push(`${rpc} → status=${status} body=${body.slice(0, 120)}`);
    }
    expect(failures, `Unguarded RPCs:\n${failures.join("\n")}`).toEqual([]);
  });

  it("P0-3: client sets Idempotency-Key on non-GET AND server synthesizes when absent", () => {
    const clientRaw = readWeb("lib/api-client.js");
    const serverRaw = readWeb("lib/api/idempotency.ts");
    // Strip block + line comments so docstrings about the previous behaviour
    // do not trip the regex below.
    const stripComments = (s: string) =>
      s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const client = stripComments(clientRaw);
    const server = stripComments(serverRaw);

    // Client half: api-client.js must set Idempotency-Key for non-GET requests.
    const clientSets =
      /Idempotency-Key/.test(client) &&
      /(synth|hash|randomUUID|FNV|bucket)/i.test(client);
    expect(clientSets, "lib/api-client.js does not synthesize an Idempotency-Key on non-GET requests").toBe(true);

    // Server half: when header is absent, the wrapper must compute a key from
    // actor+route+body-hash AND insert a pending row BEFORE running the
    // handler. We forbid the legacy short-circuit pattern.
    const serverSynth = /(synth|canonical|bodyHash|hashtext|fnv|sha)/i.test(server);
    const shortCircuit = /if\s*\(!key\)\s*return\s*run\s*\(\s*\)/.test(server);
    const reservesPending =
      /(tryReservePending|ON CONFLICT DO NOTHING|ignoreDuplicates:\s*true|reservePending|insertPending)/i.test(server);
    expect(serverSynth, "lib/api/idempotency.ts has no synthesized fallback key").toBe(true);
    expect(shortCircuit, "lib/api/idempotency.ts still short-circuits with `if (!key) return run()`").toBe(false);
    expect(reservesPending, "lib/api/idempotency.ts does not insert a pending row before run()").toBe(true);
  });

  it("P0-4: cron/duties-extend refuses to run without a secret, regardless of VERCEL_ENV; Bearer only", () => {
    const raw = readWeb("app/api/v1/cron/duties-extend/route.ts");
    // Strip // line comments and /* block comments */ so docstrings about
    // "we removed the legacy header" do not trip the assertions below.
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    // (a) fails closed when secret is missing AND no VERCEL_ENV bypass in code path
    const failsClosed =
      /if\s*\(!secret\)\s*\{[\s\S]*?return\s+respond\s*\(\s*failure/.test(src) &&
      !/VERCEL_ENV\s*!==\s*['"]production['"]/.test(src);
    expect(failsClosed, "cron route still has a VERCEL_ENV bypass / missing fail-closed branch").toBe(true);
    // (b) legacy x-cron-secret path removed from code (not just commented out)
    const onlyBearer = !/headers\.get\(\s*["']x-cron-secret["']/i.test(src);
    expect(onlyBearer, "cron route still reads legacy `x-cron-secret` header in code").toBe(true);
  });

  it("P0-5: patientService.remove cascades close through a single hominal_close_patient RPC", () => {
    const src = readWeb("src/services/patientService.ts");
    const callsCloseRpc =
      /closeCascadeRpc\s*\(/.test(src) || /hominal_close_patient/.test(src);
    expect(callsCloseRpc, "patientService.remove does not invoke hominal_close_patient RPC").toBe(true);
    // It should also NOT be doing ad-hoc cap+cancel calls per duty/bill outside the RPC.
    const adhocCap = /capLinkedDutiesOnBillingClose\s*\(/.test(src);
    expect(adhocCap, "patientService.remove still does ad-hoc capLinkedDutiesOnBillingClose outside the RPC").toBe(false);
  });

  it("P0-6: idSchema is strict regex AND repo q-handlers sanitize via sanitizeSearchTerm", () => {
    const common = readWeb("src/validation/commonValidation.ts");
    // Match the literal char class `[A-Za-z0-9_-]{1,64}` within the idSchema declaration.
    const idSchemaStrict = /idSchema[\s\S]{0,300}\[A-Za-z0-9_-\]\{1,64\}/.test(common);
    expect(idSchemaStrict, "idSchema is not the strict /^[A-Za-z0-9_-]{1,64}$/ regex").toBe(true);

    const sanitize = readWeb("src/utils/searchTerm.ts");
    const stripsBadChars = /replace\([\s\S]{0,40}\[[,()*%\\\\]+/.test(sanitize);
    expect(stripsBadChars, "sanitizeSearchTerm does not strip , ( ) % \\ characters").toBe(true);

    // At least the 5 financial / high-traffic repos must import and use it.
    const repos = [
      "src/database/patientRepository.ts",
      "src/database/billingRepository.ts",
      "src/database/payoutRepository.ts",
      "src/database/employeeRepository.ts",
      "src/database/inquiryRepository.ts"
    ];
    const missing: string[] = [];
    for (const r of repos) {
      try {
        const src = readWeb(r);
        if (!/sanitizeSearchTerm\s*\(/.test(src)) missing.push(r);
      } catch (e) {
        missing.push(`${r} (${(e as Error).message})`);
      }
    }
    expect(missing, `repos not using sanitizeSearchTerm:\n${missing.join("\n")}`).toEqual([]);
  });

  it("P0-7: signed-download route gates with requireRole AND max TTL ≤ 1800", () => {
    const route = readWeb("app/api/v1/uploads/signed-download/route.ts");
    const hasRole =
      /requireRole\s*\(\s*actor\s*,\s*\[[^\]]*Admin[^\]]*Manager[^\]]*Accountant[^\]]*Staff/.test(route);
    expect(hasRole, "signed-download route missing requireRole(...) with the expected role list").toBe(true);

    const svc = readWeb("src/services/storageService.ts");
    const ttlOk = /expires_in\s*:\s*z\.[\s\S]{0,80}\.max\(\s*1800\s*\)/.test(svc);
    expect(ttlOk, "storageService.createSignedDownload expires_in.max(1800) not found").toBe(true);

    const defaultsLow = /\.default\(\s*([0-9]+)\s*\)/.exec(svc);
    expect(defaultsLow, "expires_in default not detected in storageService.ts").not.toBeNull();
    if (defaultsLow) {
      const n = Number(defaultsLow[1]);
      expect(n, `expires_in default = ${n}; must be ≤ 300`).toBeLessThanOrEqual(300);
    }
  });
});
