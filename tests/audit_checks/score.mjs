#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";

const FILE = ".last-run.json";
if (!existsSync(FILE)) {
  console.error("score.mjs: " + FILE + " not found. Run `npm run score` (which writes the file first).");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(FILE, "utf8"));
const tests = [];

function walk(node) {
  if (!node) return;
  if (Array.isArray(node.testResults)) {
    for (const f of node.testResults) walk(f);
  }
  if (Array.isArray(node.assertionResults)) {
    for (const a of node.assertionResults) tests.push(a);
  }
}
walk(raw);

const rows = [];
for (const t of tests) {
  const m = (t.title || t.fullName || "").match(/(P[01]-\d+)/);
  if (!m) continue;
  const id = m[1];
  const sev = id.startsWith("P0") ? "P0" : "P1";
  const status = t.status === "passed" ? "PASS" : t.status === "skipped" ? "SKIP" : "FAIL";
  const reason =
    t.status === "passed"
      ? ""
      : (Array.isArray(t.failureMessages) && t.failureMessages[0]
          ? String(t.failureMessages[0]).split("\n").find(Boolean) || ""
          : "");
  rows.push({ id, sev, status, reason });
}

rows.sort((a, b) => {
  if (a.sev !== b.sev) return a.sev < b.sev ? -1 : 1;
  const an = parseInt(a.id.split("-")[1], 10);
  const bn = parseInt(b.id.split("-")[1], 10);
  return an - bn;
});

const widthId = Math.max(4, ...rows.map((r) => r.id.length));
const widthStatus = 6;
function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

console.log("");
console.log(pad("ID", widthId) + "  " + pad("Sev", 3) + "  " + pad("Status", widthStatus) + "  Reason");
console.log("─".repeat(widthId) + "  ─".repeat(3 / 2 + 1) + "  " + "─".repeat(widthStatus) + "  " + "─".repeat(40));
for (const r of rows) {
  console.log(
    pad(r.id, widthId) +
      "  " +
      pad(r.sev, 3) +
      "  " +
      pad(r.status, widthStatus) +
      "  " +
      r.reason.replace(/\s+/g, " ").slice(0, 100)
  );
}

const passing = rows.filter((r) => r.status === "PASS").length;
const total = rows.length;
const pct = total ? Math.round((passing / total) * 1000) / 10 : 0;
console.log("");
console.log("Baseline: " + passing + " / " + total + " passing (" + pct + "%)");
