#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required (install Node.js 20+)." >&2
  exit 1
fi

if [[ -z "${VERCEL_TOKEN:-}" ]]; then
  echo "Set VERCEL_TOKEN (Vercel → Settings → Tokens)." >&2
  exit 1
fi

if [[ -z "${VERCEL_ORG_ID:-}" || -z "${VERCEL_PROJECT_ID_API:-}" || -z "${VERCEL_PROJECT_ID_WEB:-}" ]]; then
  echo "Set VERCEL_ORG_ID, VERCEL_PROJECT_ID_API, VERCEL_PROJECT_ID_WEB (each project → Settings → General)." >&2
  exit 1
fi

echo "==> Deploy API (apps/api) — production"
(
  cd "$ROOT/apps/api"
  VERCEL_ORG_ID="$VERCEL_ORG_ID" VERCEL_PROJECT_ID="$VERCEL_PROJECT_ID_API" \
    npx --yes vercel@latest deploy --prod --yes --token "$VERCEL_TOKEN"
)

echo "==> Deploy Web (apps/web) — production"
(
  cd "$ROOT/apps/web"
  VERCEL_ORG_ID="$VERCEL_ORG_ID" VERCEL_PROJECT_ID="$VERCEL_PROJECT_ID_WEB" \
    npx --yes vercel@latest deploy --prod --yes --token "$VERCEL_TOKEN"
)

echo "Done. Run pending Supabase migrations (e.g. 004) in the Supabase SQL editor or: supabase db push"
