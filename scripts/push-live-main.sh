#!/usr/bin/env bash
# Push Phase 3 + vercel-web CI to GitHub main → triggers Vercel production deploy.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REMOTE="${GIT_REMOTE:-origin}"
REPO_URL="${GIT_REPO_URL:-https://github.com/tonieradius/hominal-healthcare-crm.git}"
BRANCH="${GIT_BRANCH:-cursor/fix-service-open}"

if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
  git remote add "$REMOTE" "$REPO_URL"
fi

echo "==> Fetch $REMOTE"
git fetch "$REMOTE"

if git show-ref --verify --quiet "refs/remotes/$REMOTE/main"; then
  echo "==> Merge local $BRANCH into main (no force push)"
  git checkout -B main "$REMOTE/main"
  git merge --no-edit "$BRANCH" || {
    echo "Merge conflict — resolve, then: git push $REMOTE main" >&2
    exit 1
  }
else
  echo "==> No remote main yet; publish $BRANCH as main"
  git checkout -B main "$BRANCH"
fi

echo "==> Push main to $REMOTE (GitHub Actions deploys vercel-web)"
git push -u "$REMOTE" main

echo ""
echo "Done. Check: https://github.com/tonieradius/hominal-healthcare-crm/actions"
echo "Live CRM: https://crm.hominalhealthcare.com/legacy-crm.html?v=phase3-20260520-3"
echo ""
echo "Also run in Supabase SQL editor: hominal_crm_supabase_011_phase3_rls_rpc.sql"
