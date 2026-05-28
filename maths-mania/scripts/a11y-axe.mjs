#!/usr/bin/env node
/**
 * Run axe on key public routes (requires dev server + @axe-core/cli).
 *
 *   npm run dev
 *   npm install -D @axe-core/cli
 *   npm run a11y:axe
 */
import { spawnSync } from "node:child_process";

const base = process.env.A11Y_URL ?? "http://localhost:3000";
const paths = ["/", "/exams", "/courses", "/contact", "/blog"];

let failed = 0;

for (const path of paths) {
  const url = `${base.replace(/\/$/, "")}${path}`;
  console.log(`\naxe — ${url}`);
  const result = spawnSync(
    "npx",
    ["@axe-core/cli", url, "--exit"],
    { stdio: "inherit", shell: true },
  );
  if (result.status !== 0) failed += 1;
}

process.exit(failed > 0 ? 1 : 0);
