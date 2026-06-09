#!/usr/bin/env bash
# Pre-push gate for todoist-backlog-scheduler.
#
# Invoked by .git-hooks/pre-push (core.hooksPath=.git-hooks, wired by `npm run
# prepare`). Replaces the old .github/workflows/ci.yml. That workflow was
# CI-only (never deployed), so this hook is gate-only: the SAM deploy stays a
# manual local step (`npm run deploy`), unchanged.
#
# Only acts on a non-deleting push to main/master; feature-branch pushes stay
# fast. Escape hatch: FLEET_SKIP_PREPUSH=1 git push (audited).
set -euo pipefail

if [ "${FLEET_SKIP_PREPUSH:-}" = "1" ]; then
  echo "⚠ FLEET_SKIP_PREPUSH=1 — skipping pre-push gate" >&2
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# pre-push stdin: <local ref> <local sha> <remote ref> <remote sha>
ZERO="0000000000000000000000000000000000000000"
push_to_main=""
while read -r _local_ref local_sha remote_ref _remote_sha; do
  case "$remote_ref" in
    refs/heads/main | refs/heads/master)
      [ "$local_sha" = "$ZERO" ] && continue
      push_to_main="$remote_ref"
      ;;
  esac
done
[ -z "$push_to_main" ] && exit 0

echo "▶ pre-push gate (todoist-backlog-scheduler) → $push_to_main"
echo "• biome ci"
npx biome ci . --error-on-warnings
echo "• tsc --noEmit"
npm run check:ts
echo "• vitest"
npm test
echo "• sam validate"
sam validate --lint -t aws/template.yaml

# Deploy is NOT in this hook — todoist's CI workflow never deployed. Ship with
# the manual local step: `npm run deploy` (sam build && sam deploy).
echo "✓ pre-push gate complete  (deploy is manual: npm run deploy)"
