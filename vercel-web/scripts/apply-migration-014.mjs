#!/usr/bin/env node
/**
 * Apply hominal_crm_supabase_014_audit_system_safe.sql via Supabase service role.
 * Uses the pg meta / SQL over HTTP if available; otherwise probes column existence.
 *
 * Usage:
 *   source /path/to/env-with-SUPABASE_SERVICE_ROLE_KEY
 *   node scripts/apply-migration-014.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function columnExists(name) {
  const { error } = await supabase.from("hh_audit_logs").select(name).limit(1);
  if (!error) return true;
  const msg = (error.message || "").toLowerCase();
  if (msg.includes("column") && msg.includes("does not exist")) return false;
  if (msg.includes("could not find")) return false;
  console.warn(`column probe for ${name}:`, error.message);
  return false;
}

async function main() {
  console.log("Probing hh_audit_logs schema…");

  const hasTable = !(await supabase.from("hh_audit_logs").select("id").limit(1)).error;
  if (!hasTable) {
    console.error("hh_audit_logs table not found — apply migrations 011/012 in Supabase SQL editor first.");
    process.exit(1);
  }

  const needUserId = !(await columnExists("user_id"));
  const needBefore = !(await columnExists("before"));
  const needAfter = !(await columnExists("after"));
  const needActor = !(await columnExists("actor"));

  if (!needUserId && !needBefore && !needAfter && !needActor) {
    console.log("Schema already has required audit columns — nothing to do.");
    process.exit(0);
  }

  console.log("Missing columns:", {
    user_id: needUserId,
    before: needBefore,
    after: needAfter,
    actor: needActor
  });

  // Service role cannot run DDL via PostgREST — print SQL for manual apply.
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const sqlPath = join(root, "hominal_crm_supabase_014_audit_system_safe.sql");
  const sql = readFileSync(sqlPath, "utf8");

  console.log("\n--- Run this in Supabase → SQL Editor (additive, safe to re-run) ---\n");
  console.log(sql);
  console.log("\n--- Or paste the file: hominal_crm_supabase_014_audit_system_safe.sql ---\n");

  // Attempt insert probe after suggesting manual step
  const probe = await supabase.from("hh_audit_logs").insert({
    module: "migration_probe",
    entity_id: "probe",
    action: "probe",
    actor: "system",
    user_id: needUserId ? null : "probe",
    stamp: "migration probe",
    before: null,
    after: { ok: true }
  }).select("id").single();

  if (probe.error) {
    console.error("Probe insert failed (expected if user_id column missing):", probe.error.message);
    process.exit(2);
  }

  if (probe.data?.id) {
    await supabase.from("hh_audit_logs").delete().eq("id", probe.data.id);
    console.log("Probe insert succeeded — audit table writable.");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
