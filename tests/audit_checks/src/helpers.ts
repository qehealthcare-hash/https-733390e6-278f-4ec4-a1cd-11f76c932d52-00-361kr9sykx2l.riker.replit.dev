import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, resolve, relative } from "node:path";

/** Repo root, computed from this file's location. */
export const REPO = resolve(__dirname, "..", "..", "..");
export const WEB = join(REPO, "vercel-web");

/** Read a workspace file by repo-relative path. Throws a clear message if missing. */
export function readWeb(relPath: string): string {
  const full = join(WEB, relPath);
  if (!existsSync(full)) {
    throw new Error(`MISSING_FILE: vercel-web/${relPath}`);
  }
  return readFileSync(full, "utf8");
}

export function existsWeb(relPath: string): boolean {
  return existsSync(join(WEB, relPath));
}

/** Walk `vercel-web/app/**\/page.js`. */
export function appPages(): string[] {
  const root = join(WEB, "app");
  const out: string[] = [];
  function walk(dir: string) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "page.js" || entry.name === "page.jsx" || entry.name === "page.tsx") out.push(full);
    }
  }
  walk(root);
  return out;
}

/** True if any character of `pattern` regex appears in `text`. */
export function matches(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

/** Count of regex matches across text. */
export function count(text: string, pattern: RegExp): number {
  const m = text.match(new RegExp(pattern.source, (pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g")));
  return m ? m.length : 0;
}

// ───────────────────────────────────────────────────────────────────────────────
// Supabase REST helpers — used only by DB/runtime probes. Read env at call time.
// ───────────────────────────────────────────────────────────────────────────────

export interface SupabaseEnv {
  url: string;
  serviceRoleKey: string;
}

export function requireSupabaseEnv(): SupabaseEnv {
  const url = process.env.SUPABASE_URL || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceRoleKey) {
    throw new Error("ENV_MISSING: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required for this probe");
  }
  return { url, serviceRoleKey };
}

export function requireNurseJwt(): string {
  const jwt = process.env.NURSE_JWT || "";
  if (!jwt) throw new Error("ENV_MISSING: NURSE_JWT required for runtime RPC probe");
  return jwt;
}

/**
 * Run a SQL query through the Supabase admin SQL endpoint
 * (`/rest/v1/rpc/<sql_fn>` is not available; we use the Management API style
 * fallback via `pg_proc` exposed through a custom rpc named `exec_sql` is
 * NOT assumed here — instead we hit PostgREST views via select).
 *
 * We use the `pg_catalog`-derived views that Supabase exposes by default:
 *  - `pg_proc` (via the `public.hh_pg_proc` helper if present, else direct
 *    PostgREST query through `?select=` on `information_schema` tables).
 *
 * To keep this dependency-free we use a small SQL-via-rpc helper. If the
 * project does not have a generic exec helper, the probe fails with a clear
 * `ENV_MISSING` / `PROBE_UNSUPPORTED` message — encoded as a test failure.
 */
export async function sqlSelect<T = unknown>(query: string): Promise<T[]> {
  const env = requireSupabaseEnv();
  // Supabase generic SQL execution is only available through the Management
  // API (different host) or a custom RPC. We attempt the Management-style
  // endpoint Supabase exposes for the local CLI at /pg/* — falls through if
  // not enabled. Most projects do NOT have a generic SQL RPC, so a probe
  // that needs raw SQL must either rely on a project-specific helper or be
  // marked unsupported.
  const adminQueryUrl = env.url.replace(/\/$/, "") + "/pg/query";
  const res = await fetch(adminQueryUrl, {
    method: "POST",
    headers: {
      apikey: env.serviceRoleKey,
      Authorization: `Bearer ${env.serviceRoleKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PROBE_UNSUPPORTED: ${res.status} ${res.statusText} — ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { rows?: T[] } | T[];
  return Array.isArray(json) ? json : json.rows || [];
}

/**
 * Get a function body via `pg_get_functiondef` if a project-local helper RPC
 * exists. Returns `null` when the helper isn't deployed so the test can fail
 * cleanly. Helper SQL (deploy once):
 *
 *   create function public._audit_get_funcdef(p_oid oid)
 *     returns text language sql security definer as $$
 *       select pg_get_functiondef(p_oid);
 *     $$;
 *   revoke all on function public._audit_get_funcdef from public;
 */
export async function getFunctionDef(name: string): Promise<string | null> {
  try {
    const rows = await sqlSelect<{ src: string }>(
      `select pg_get_functiondef(p.oid) as src
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = ${literal(name)}
        limit 1`
    );
    if (!rows.length) return null;
    return rows[0].src;
  } catch (e) {
    throw e;
  }
}

function literal(s: string) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

/**
 * Runtime RPC probe — POST a destructive RPC with a Nurse JWT and assert
 * we get an HTTP 4xx with Postgres error code `42501` (insufficient_privilege).
 */
export async function probeRpcAsNurse(rpcName: string, body: Record<string, unknown>) {
  const env = requireSupabaseEnv();
  const jwt = requireNurseJwt();
  const res = await fetch(env.url.replace(/\/$/, "") + "/rest/v1/rpc/" + rpcName, {
    method: "POST",
    headers: {
      apikey: env.serviceRoleKey, // anon key works too — we use service key as `apikey` only for transport
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(body)
  });
  const text = await res.text().catch(() => "");
  return { status: res.status, body: text };
}
