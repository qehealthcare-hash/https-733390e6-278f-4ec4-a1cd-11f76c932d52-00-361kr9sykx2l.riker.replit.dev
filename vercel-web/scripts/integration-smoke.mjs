#!/usr/bin/env node
/**
 * Live HTTP smoke test for the full CRM workflow.
 *
 * Touches a single fresh patient + employee through the entire lifecycle:
 *   1. create patient
 *   2. create employee
 *   3. assign duty
 *   4. mark attendance
 *   5. generate bill (from duty)
 *   6. ensure/recompute payout
 *   7. close bill (with force when receipts missing)
 *   8. close payout (lock)
 *   9. fetch dashboard KPIs
 *  10. fetch profit-loss report
 *  11. refetch each entity, assert it persists
 *  12. exercise edge cases (invalid patient, duplicate duty, edit-after-close,
 *      cancel-completed, status guards) and confirm the API rejects them
 *
 * Usage:
 *   export CRM_BASE_URL=https://crm.hominalhealthcare.com
 *   export CRM_TOKEN="<supabase-jwt>"
 *   node scripts/integration-smoke.mjs
 *
 * Optional:
 *   CLEANUP=1   – attempt to soft-close test entities at the end
 *   PERIOD=2026-06   – override payout period (defaults to current YYYY-MM)
 *
 * Exit code is non-zero if any assertion fails.
 */

const base = (process.env.CRM_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const token = process.env.CRM_TOKEN || "";
const cleanup = process.env.CLEANUP === "1";
const period =
  process.env.PERIOD ||
  (() => {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  })();

if (!token) {
  console.error("CRM_TOKEN env var is required (Supabase access token).");
  process.exit(1);
}

const passed = [];
const failed = [];

function ok(name, detail = "") {
  passed.push(name);
  console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, err) {
  failed.push({ name, err });
  console.error(`  FAIL  ${name} — ${err}`);
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
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

function asUnique(prefix) {
  const stamp = Date.now().toString().slice(-6);
  return `${prefix}${stamp}`;
}

function isoOffset(hoursFromNow) {
  const d = new Date(Date.now() + hoursFromNow * 3_600_000);
  d.setUTCSeconds(0, 0);
  return d.toISOString();
}

async function expectSuccess(name, path, init) {
  const { status, body } = await api(path, init);
  if (!body || body.success !== true) {
    fail(name, `HTTP ${status} ${body?.error || body?.code || "no body"}`);
    return null;
  }
  ok(name, body?.data?.id ? `id=${body.data.id}` : `${status}`);
  return body.data;
}

async function expectFailureCode(name, path, init, expectedCode) {
  const { status, body } = await api(path, init);
  if (body?.success === false && (!expectedCode || body.code === expectedCode)) {
    ok(name, `${status} ${body.code}`);
    return true;
  }
  fail(name, `expected failure (${expectedCode || "any"}); got ${status} ${JSON.stringify(body)}`);
  return false;
}

async function main() {
  console.log(`CRM integration smoke @ ${base}  (period=${period})\n`);

  const health = await api("/api/v1/health");
  if (health.status !== 200) fail("health", `HTTP ${health.status}`);
  else ok("health");

  // ── step 1: create patient ───────────────────────────────────────────────
  const patient = await expectSuccess("create patient", "/api/v1/patients", {
    method: "POST",
    body: JSON.stringify({
      name: `QA Patient ${asUnique("")}`,
      phone: `+91${Math.floor(7_000_000_000 + Math.random() * 2_000_000_000)}`,
      status: "Active"
    })
  });
  if (!patient) return finalize();
  const patientId = patient.id;

  // duplicate patient (same phone) — must fail
  await expectFailureCode(
    "duplicate patient blocked",
    "/api/v1/patients",
    {
      method: "POST",
      body: JSON.stringify({ name: patient.name, phone: patient.phone, status: "Active" })
    },
    "duplicate"
  );

  // invalid patient
  await expectFailureCode(
    "invalid patient (missing phone) rejected",
    "/api/v1/patients",
    { method: "POST", body: JSON.stringify({ name: "No Phone" }) },
    "validation_error"
  );

  // ── step 2: create employee ──────────────────────────────────────────────
  const employee = await expectSuccess("create employee", "/api/v1/employees", {
    method: "POST",
    body: JSON.stringify({
      fn: "QA",
      ln: `Caretaker ${asUnique("")}`,
      phone: `+91${Math.floor(7_000_000_000 + Math.random() * 2_000_000_000)}`,
      role: "ATTENDANT",
      shift: "DAY",
      status: "Active"
    })
  });
  if (!employee) return finalize();
  const employeeId = employee.id;

  // ── step 3: assign duty ──────────────────────────────────────────────────
  const startAt = isoOffset(-4);
  const endAt = isoOffset(2);
  const duty = await expectSuccess("create duty", "/api/v1/duties", {
    method: "POST",
    body: JSON.stringify({
      patient_id: patientId,
      employee_id: employeeId,
      start_at: startAt,
      end_at: endAt,
      shift_type: "DAY",
      status: "SCHEDULED"
    })
  });
  if (!duty) return finalize();
  const dutyId = duty.id;

  await expectFailureCode(
    "duplicate duty (overlapping window) blocked",
    "/api/v1/duties",
    {
      method: "POST",
      body: JSON.stringify({
        patient_id: patientId,
        employee_id: employeeId,
        start_at: isoOffset(-3),
        end_at: isoOffset(3),
        shift_type: "DAY",
        status: "SCHEDULED"
      })
    }
  );

  // ── step 4: mark attendance ──────────────────────────────────────────────
  const attendance = await expectSuccess("mark attendance", "/api/v1/attendance/mark", {
    method: "POST",
    body: JSON.stringify({
      duty_id: dutyId,
      employee_id: employeeId,
      patient_id: patientId,
      shift_type: "DAY",
      check_in_at: startAt,
      check_out_at: endAt,
      status: "PRESENT"
    })
  });
  if (!attendance) return finalize();

  // ── step 5: generate bill from duty ──────────────────────────────────────
  const bill = await expectSuccess("generate bill from duty", "/api/v1/billings/generate", {
    method: "POST",
    body: JSON.stringify({
      duty_id: dutyId,
      service_name: "Caretaker",
      period
    })
  });
  if (!bill) return finalize();
  const billingId = bill?.billing?.id || bill?.billing_id || bill?.id;
  if (!billingId) fail("billing id present", `unexpected shape ${JSON.stringify(bill).slice(0, 120)}`);

  // ── step 6: ensure payout ────────────────────────────────────────────────
  const payout = await expectSuccess("ensure payout", "/api/v1/payouts", {
    method: "POST",
    body: JSON.stringify({
      employee_id: employeeId,
      period_month: period,
      advance: 0,
      deduction: 0,
      bonus: 0
    })
  });
  if (!payout) return finalize();
  const payoutId = payout.id;

  // ── step 7: close bill (force=true since no receipt was recorded) ────────
  await expectSuccess(`close bill ${billingId}`, `/api/v1/billings/${billingId}/close`, {
    method: "POST",
    body: JSON.stringify({ reason: "QA smoke", force: true })
  });

  await expectFailureCode(
    "edit closed bill blocked",
    `/api/v1/billings/${billingId}`,
    { method: "PATCH", body: JSON.stringify({ sec_dep: 99999 }) },
    "business_rule_violation"
  );

  // ── step 8: lock payout ──────────────────────────────────────────────────
  await expectSuccess(`lock payout ${payoutId}`, `/api/v1/payouts/${payoutId}/lock`, {
    method: "POST",
    body: JSON.stringify({ reason: "QA smoke" })
  });

  await expectFailureCode(
    "adjust locked payout blocked",
    "/api/v1/payouts/adjust",
    {
      method: "POST",
      body: JSON.stringify({ payout_id: payoutId, bonus: 50 })
    },
    "business_rule_violation"
  );

  // ── step 9: dashboard ────────────────────────────────────────────────────
  const dashboard = await expectSuccess("dashboard KPIs", `/api/v1/reports/dashboard?period=${period}`);
  if (dashboard) {
    if (typeof dashboard.billing_total_amount !== "number") fail("dashboard has billing total", "missing field");
    if (typeof dashboard.payout_total_amount !== "number") fail("dashboard has payout total", "missing field");
  }

  // ── step 10: reports ─────────────────────────────────────────────────────
  await expectSuccess("profit/loss report", `/api/v1/reports/profit-loss?period=${period}`);
  await expectSuccess("billing totals report", `/api/v1/reports/billing-totals?period=${period}`);
  await expectSuccess("payout totals report", `/api/v1/reports/payout-totals?period=${period}`);

  // ── step 11: refetch each entity (page refresh parity) ───────────────────
  await expectSuccess("refetch patient", `/api/v1/patients/${patientId}`);
  await expectSuccess("refetch employee", `/api/v1/employees/${employeeId}`);
  await expectSuccess("refetch duty", `/api/v1/duties/${dutyId}`);
  if (billingId) await expectSuccess("refetch bill", `/api/v1/billings/${billingId}`);
  await expectSuccess("refetch payout", `/api/v1/payouts/${payoutId}`);

  // ── step 12: audit trail visible ─────────────────────────────────────────
  const audits = await expectSuccess("audit trail visible", `/api/v1/audits?limit=20&entity_id=${patientId}`);
  if (audits && Array.isArray(audits.rows)) {
    const found = audits.rows.find((r) => r.module === "patient" && r.entity_id === patientId);
    if (found) ok("audit row for created patient", `${found.action}`);
    else fail("audit row for created patient", "no row matched module=patient + entity");
  }

  // ── step 12b: deactivate flows ───────────────────────────────────────────
  await expectSuccess(`deactivate employee ${employeeId}`, `/api/v1/employees/${employeeId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "Inactive", reason: "QA smoke" })
  });

  if (cleanup) {
    await expectSuccess(`close patient ${patientId}`, `/api/v1/patients/${patientId}`, { method: "DELETE" });
  }

  return finalize();
}

function finalize() {
  console.log(`\n=========================================`);
  console.log(`  Passed : ${passed.length}`);
  console.log(`  Failed : ${failed.length}`);
  console.log(`=========================================`);
  if (failed.length) {
    console.log("\nFailures:");
    for (const f of failed) console.log(`  - ${f.name}: ${f.err}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
