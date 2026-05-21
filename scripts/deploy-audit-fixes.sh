#!/usr/bin/env bash
# Deploys the Phase-5 audit fixes to production.
# Run this after applying hominal_crm_supabase_013_audit_fixes.sql in the Supabase SQL editor.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/vercel-web"

echo "==> 1/4  typecheck"
npm run typecheck

echo "==> 2/4  build"
npm run build

echo "==> 3/4  vercel login (browser opens if not signed in)"
npx vercel@latest login || true

echo "==> 4/4  deploy --prod"
npx vercel@latest deploy --prod --yes

echo ""
echo "Done. Now verify:"
echo "  curl https://crm.hominalhealthcare.com/api/v1/health | jq"
echo "  curl https://crm.hominalhealthcare.com/api/v1/lookups/patients -H 'Authorization: Bearer <token>'"
