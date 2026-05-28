#!/usr/bin/env node
/**
 * Run Lighthouse against a local or deployed Maths Mania URL.
 * Usage: npm run dev (separate terminal) then npm run perf:lighthouse
 *        PERF_URL=https://mathsmania.in npm run perf:lighthouse
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const url = process.env.PERF_URL ?? "http://localhost:3000";

async function run() {
  let lighthouse;
  let chromeLauncher;
  try {
    lighthouse = require("lighthouse").default;
    chromeLauncher = require("chrome-launcher");
  } catch {
    console.error(
      "Install dev deps first: npm install -D lighthouse chrome-launcher",
    );
    process.exit(1);
  }

  const chrome = await chromeLauncher.launch({ chromeFlags: ["--headless"] });
  const options = {
    logLevel: "error",
    output: "json",
    onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
    port: chrome.port,
  };

  const result = await lighthouse(url, options);
  await chrome.kill();

  const scores = result.lhr.categories;
  const row = (name, cat) =>
    `${name.padEnd(18)} ${Math.round((cat?.score ?? 0) * 100)}`;

  console.log(`\nLighthouse — ${url}\n`);
  console.log(row("Performance", scores.performance));
  console.log(row("Accessibility", scores.accessibility));
  console.log(row("Best practices", scores["best-practices"]));
  console.log(row("SEO", scores.seo));
  console.log("");

  const perf = scores.performance?.score ?? 0;
  if (perf < 0.9) {
    console.warn("Performance below 90 — review LCP images and YouTube embeds.");
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
