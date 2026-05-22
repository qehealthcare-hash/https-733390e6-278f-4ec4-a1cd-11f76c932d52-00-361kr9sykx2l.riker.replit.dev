#!/usr/bin/env node
/**
 * Verifies audit rows exist after sample mutations.
 *
 * Usage:
 *   export CRM_BASE_URL=https://crm.hominalhealthcare.com
 *   export CRM_TOKEN="<supabase-jwt>"
 *   export TEST_PATIENT_ID=PID000001   # optional — skips patient edit if unset
 *   export TEST_BILLING_ID=INVE000001  # optional
 *   export TEST_PAYOUT_ID=PAY000001    # optional
 *   node scripts/verify-audit-trail.mjs
 */

const base = (process.env.CRM_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const token = process.env.CRM_TOKEN || "";

if (!token) {
  console.error("Set CRM_TOKEN to a valid Supabase access token.");
  process.exit(1);
}

async function api(path, init = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function listAudits(filters) {
  const q = new URLSearchParams({ limit: "10", ...filters });
  const { status, body } = await api(`/api/v1/audits?${q}`);
  if (!body.success) {
    throw new Error(body.error || `audits HTTP ${status}`);
  }
  return body.data?.rows || [];
}

function assertRecent(rows, predicate, label) {
  const hit = rows.find(predicate);
  if (!hit) {
    console.error(`FAIL: no audit row for ${label}`);
    console.error("Recent rows:", rows.slice(0, 5).map((r) => ({
      module: r.module,
      action: r.action,
      entity_id: r.entity_id,
      created_at: r.created_at
    })));
    return false;
  }
  console.log(`OK: ${label}`, {
    id: hit.id,
    module: hit.module,
    action: hit.action,
    entity_id: hit.entity_id,
    user_id: hit.user_id,
    actor: hit.actor
  });
  return true;
}

async function main() {
  console.log("Audit trail verification @", base);

  const health = await api("/api/v1/health");
  if (!health.body?.success && health.status !== 200) {
    console.warn("Health check:", health.status, health.body);
  }

  let ok = true;
  const patientId = process.env.TEST_PATIENT_ID;
  if (patientId) {
    const patch = await api(`/api/v1/patients/${patientId}`, {
      method: "PATCH",
      body: JSON.stringify({ notes: `audit-verify ${Date.now()}` })
    });
    if (!patch.body.success) {
      console.warn("Patient PATCH skipped:", patch.body.error || patch.status);
    } else {
      const rows = await listAudits({ module: "patient", entity_id: patientId });
      ok = assertRecent(
        rows,
        (r) => r.module === "patient" && r.action === "update" && r.entity_id === patientId,
        "patient edit"
      ) && ok;
    }
  } else {
    console.log("SKIP patient edit (set TEST_PATIENT_ID)");
  }

  const billId = process.env.TEST_BILLING_ID;
  if (billId) {
    const rows = await listAudits({ module: "billing", entity_id: billId });
    ok =
      assertRecent(
        rows,
        (r) => r.module === "billing" && (r.action === "close" || r.action === "update"),
        "billing close/history"
      ) && ok;
  } else {
    console.log("SKIP billing (set TEST_BILLING_ID after closing a bill in UI)");
  }

  const payoutId = process.env.TEST_PAYOUT_ID;
  if (payoutId) {
    const rows = await listAudits({ module: "payout", entity_id: payoutId });
    ok =
      assertRecent(
        rows,
        (r) => r.module === "payout" && (r.action === "close" || r.action === "update"),
        "payout close/history"
      ) && ok;
  } else {
    console.log("SKIP payout (set TEST_PAYOUT_ID after locking a payout in UI)");
  }

  const recent = await listAudits({ limit: "5" });
  console.log("\nLatest audit rows:");
  recent.forEach((r) => {
    console.log(`  ${r.created_at}  ${r.module}/${r.action}  ${r.entity_id}  ${r.actor}`);
  });

  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
