# audit_checks

Regression test suite for **`HOMINAL_CRM_ENTERPRISE_QA_AUDIT_2026-05-28.md`**, scored against the frozen checklist in **`audit-rubric.md`**.

- One `it()` per rubric ID (`P0-1`, `P0-2`, … `P1-38`) — **45 checks**.
- Each test fails today (before the fix) and passes only when the fix lands.
- Score = `passing / 45` × 100. No LLM judgment.

## Methods

| Method | Used for |
|---|---|
| `fs` + regex (cheapest) | Whether source files contain / omit specific patterns. |
| Supabase REST + `pg_proc` (SQL probe) | Function bodies / FK delete rules / CHECK constraints / grants. |
| HTTPS POST with a low-privilege JWT (runtime probe) | `P0-2` — `Nurse` JWT must get 403 / `42501` on all 7 destructive RPCs. |

## Env vars (optional — DB / runtime probes degrade to a clean fail without them)

```sh
export SUPABASE_URL=https://hkyjxdmkqkydnrafhpgn.supabase.co
export SUPABASE_ANON_KEY=...
export SUPABASE_SERVICE_ROLE_KEY=...   # SQL probes (pg_proc)
export NURSE_JWT=...                    # P0-2 runtime probe
```

When env is missing the test fails with `ENV_MISSING: …` so it never silently scores a pass.

## Run

```sh
cd tests/audit_checks
npm install
npm test            # human-readable verbose
npm run score       # JSON → score.mjs prints the baseline table
```

## Rules (from project guardrails)

1. Each fix ships in its own commit with the finding ID (e.g. `P1-8:`).
2. The check above is the only thing that decides whether a finding is closed.
3. DB migrations preserve existing function bodies — never `CREATE OR REPLACE` blind.
4. Client-side dependencies ship in the same commit as the server change.
