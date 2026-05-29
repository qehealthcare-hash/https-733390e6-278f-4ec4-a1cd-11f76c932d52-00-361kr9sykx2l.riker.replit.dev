#!/usr/bin/env node
/**
 * Prepare load-test users, registrations, and k6 env file.
 *
 * Requires .env.local with Supabase URL + service role + anon key.
 *
 *   node scripts/loadtest-prepare.mjs
 *   node scripts/loadtest-prepare.mjs --users 100 --slug ibps-quant-speed-test-2
 */
import { createClient } from "@supabase/supabase-js";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadEnvLocal() {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(path.join(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      const key = t.slice(0, i).trim();
      const val = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* .env.local optional if vars exported */
  }
}

// top-level await in prepare - fix by wrapping in main
async function main() {
  await loadEnvLocal();

  const args = process.argv.slice(2);
  let userCount = 50;
  let slug = process.env.LOAD_TEST_EXAM_SLUG || "ibps-quant-speed-test-2";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--users") userCount = Number(args[++i] || 50);
    if (args[i] === "--slug") slug = args[++i] || slug;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const baseUrl = process.env.BASE_URL || "http://localhost:3000";
  const password = process.env.LOAD_TEST_PASSWORD || "LoadTest123!";

  if (!url || !serviceKey || !anonKey) {
    console.error(
      "Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local",
    );
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: exam, error: examErr } = await admin
    .from("exams")
    .select("id, slug, title, status, starts_at, ends_at")
    .eq("slug", slug)
    .maybeSingle();

  if (examErr || !exam) {
    console.error("Exam not found:", slug, examErr?.message);
    process.exit(1);
  }

  const { data: questions, error: qErr } = await admin
    .from("exam_questions")
    .select("id")
    .eq("exam_id", exam.id)
    .order("position");

  if (qErr || !questions?.length) {
    console.error("No questions for exam:", qErr?.message);
    process.exit(1);
  }

  console.log(`Exam: ${exam.title} (${exam.id}) — ${questions.length} questions`);
  console.log(`Creating ${userCount} load-test users…`);

  const tokens = [];
  const stamp = Date.now();

  for (let i = 0; i < userCount; i++) {
    const email = `loadtest+${stamp}.${i}@mathsmania.loadtest`;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `Load Test ${i}` },
    });

    if (createErr || !created.user) {
      console.warn(`User ${i} failed:`, createErr?.message);
      continue;
    }

    const userId = created.user.id;

    await admin.from("exam_registrations").upsert(
      {
        exam_id: exam.id,
        user_id: userId,
        reminder_sent_24h: false,
        reminder_sent_1h: false,
      },
      { onConflict: "exam_id,user_id" },
    );

    const { data: session, error: signErr } = await anon.auth.signInWithPassword({
      email,
      password,
    });

    if (signErr || !session.session?.access_token) {
      console.warn(`Sign-in ${i} failed:`, signErr?.message);
      continue;
    }

    tokens.push(session.session.access_token);
    if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${userCount} ready`);
  }

  if (tokens.length === 0) {
    console.error("No tokens minted.");
    process.exit(1);
  }

  const envPayload = {
    BASE_URL: baseUrl,
    EXAM_ID: exam.id,
    AUTH_TOKENS: tokens.join(","),
    QUESTION_IDS: questions.map((q) => q.id).join(","),
    LOAD_TEST_MAX_VUS: String(Math.min(userCount, 500)),
  };

  const envLines = Object.entries(envPayload)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const outPath = path.join(__dirname, ".loadtest-env.json");
  await writeFile(
    outPath,
    JSON.stringify({ ...envPayload, note: "Use: k6 run --env-file (export vars manually from this file)" }, null, 2),
    "utf8",
  );

  const dotEnvPath = path.join(__dirname, ".loadtest.env");
  await writeFile(dotEnvPath, envLines + "\n", "utf8");

  console.log(`\nWrote ${tokens.length} tokens → scripts/.loadtest.env`);
  console.log("Run smoke:  k6 run scripts/loadtest-smoke.js -e BASE_URL=" + baseUrl);
  console.log(
    "Run storm:  k6 run --env-file scripts/.loadtest.env scripts/loadtest.js",
  );
  console.log(
    "\nEnsure the exam window is LIVE (starts_at <= now <= ends_at). Adjust in admin if needed.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
