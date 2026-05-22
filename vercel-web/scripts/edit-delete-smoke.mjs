#!/usr/bin/env node
/**
 * Edit + Delete (CRUD lifecycle) smoke test against production. Verifies the
 * exact `/api/v1/*` endpoints the React UI hits when the user clicks edit /
 * delete on each module. Pairs with `integration-smoke.mjs`.
 *
 * Usage:
 *   CRM_BASE_URL=https://crm.hominalhealthcare.com CRM_TOKEN=... \
 *     node scripts/edit-delete-smoke.mjs
 */

const base = (process.env.CRM_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const token = process.env.CRM_TOKEN || "";
if (!token) {
  console.error("CRM_TOKEN env var is required.");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json"
};

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
async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, body: json };
}

function uniqueSuffix() {
  return Date.now().toString().slice(-6);
}
function uniquePhone() {
  return `+91${Math.floor(7_000_000_000 + Math.random() * 2_000_000_000)}`;
}

async function expectOk(name, fn) {
  try {
    const { status, body } = await fn();
    if (body?.success === true) {
      ok(name, body?.data?.id ? `id=${body.data.id}` : `HTTP ${status}`);
      return body.data;
    }
    const debugDetail = body?.details
      ? ` :: ${JSON.stringify(body.details).slice(0, 500)}`
      : "";
    fail(name, `${status} ${body?.error || body?.code || ""}${debugDetail}`.trim());
  } catch (err) {
    fail(name, err.message);
  }
  return null;
}

async function run() {
  console.log(`Edit+Delete smoke @ ${base}\n`);

  // ── PATIENT ───────────────────────────────────────────────────────────
  // Mirrors the UI flow: POST, then PATCH with the full record + edited
  // field, then DELETE. Mirrors `patientService.update` which uses the
  // canonical `patientSchema` (not a partial).
  const patCreate = await expectOk("patient: create", () =>
    api("POST", "/api/v1/patients", {
      name: `EditTest-${uniqueSuffix()}`,
      phone: uniquePhone(),
      status: "Active"
    })
  );
  if (patCreate) {
    const refetched = await expectOk("patient: refetch", () =>
      api("GET", `/api/v1/patients/${patCreate.id}`)
    );
    if (refetched) {
      await expectOk("patient: edit (PATCH)", () =>
        api("PATCH", `/api/v1/patients/${patCreate.id}`, {
          ...refetched,
          area: "QA-Updated"
        })
      );
    }
    await expectOk("patient: delete (soft)", () =>
      api("DELETE", `/api/v1/patients/${patCreate.id}`)
    );
  }

  // ── INQUIRY ───────────────────────────────────────────────────────────
  const inq = await expectOk("inquiry: create", () =>
    api("POST", "/api/v1/inquiries", {
      name: `Edit-Inq-${uniqueSuffix()}`,
      phone: uniquePhone(),
      status: "New",
      source: "CALL"
    })
  );
  if (inq) {
    const inqFresh = await expectOk("inquiry: refetch", () =>
      api("GET", `/api/v1/inquiries/${inq.id}`)
    );
    if (inqFresh) {
      await expectOk("inquiry: edit (PATCH)", () =>
        api("PATCH", `/api/v1/inquiries/${inq.id}`, {
          ...inqFresh,
          notes: "QA-Updated"
        })
      );
    }
    await expectOk("inquiry: delete", () =>
      api("DELETE", `/api/v1/inquiries/${inq.id}`)
    );
  }

  // ── EMPLOYEE ──────────────────────────────────────────────────────────
  const emp = await expectOk("employee: create", () =>
    api("POST", "/api/v1/employees", {
      fn: "Edit",
      ln: `Test-${uniqueSuffix()}`,
      phone: uniquePhone(),
      role: "ATTENDANT",
      shift: "DAY",
      status: "Active"
    })
  );
  if (emp) {
    const empFresh = await expectOk("employee: refetch", () =>
      api("GET", `/api/v1/employees/${emp.id}`)
    );
    if (empFresh) {
      await expectOk("employee: edit (PATCH)", () =>
        api("PATCH", `/api/v1/employees/${emp.id}`, {
          ...empFresh,
          area: "QA-Updated"
        })
      );
    }
    await expectOk("employee: deactivate via status PATCH", () =>
      api("PATCH", `/api/v1/employees/${emp.id}/status`, {
        status: "Inactive",
        reason: "QA cleanup"
      })
    );
  }

  // ── SETTINGS (read-only smoke, the write path requires Admin guard) ──
  await expectOk("settings: read services", () =>
    api("GET", "/api/v1/settings/services")
  );

  console.log(`\n=========================================`);
  console.log(`  Passed : ${passed.length}`);
  console.log(`  Failed : ${failed.length}`);
  console.log(`=========================================`);
  if (failed.length) {
    console.log("\nFailures:");
    for (const f of failed) console.log(`  - ${f.name}: ${f.err}`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
