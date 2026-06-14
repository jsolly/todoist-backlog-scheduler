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
LOCAL_SHA="" REMOTE_SHA=""
while read -r _local_ref local_sha remote_ref remote_sha; do
  case "$remote_ref" in
    refs/heads/main | refs/heads/master)
      [ "$local_sha" = "$ZERO" ] && continue
      push_to_main="$remote_ref"
      LOCAL_SHA="$local_sha"
      REMOTE_SHA="$remote_sha"
      ;;
  esac
done
[ -z "$push_to_main" ] && exit 0

# --- Doc-only fast path -------------------------------------------------------
# Skip the full gate when the pushed range touches only documentation, so prose
# edits don't pay for the lint/type/test battery. Conservative allow-list:
# root-level *.md, the docs/ tree, .github/*.md, and LICENSE — markdown that is
# site CONTENT (under src/, content/, …) still runs the full gate. Falls back to
# the full gate whenever the range can't be computed (new branch, non-fast-
# forward, missing remote sha), so it can only skip too little, never too much.
# Force the full gate with:  FLEET_DOC_FAST=0 git push
prepush_doc_only() { # <remote_sha> <local_sha>  → 0 when the fast path applies
  local remote_sha="$1" local_sha="$2" files f
  [ "${FLEET_DOC_FAST:-1}" = "1" ] || return 1
  [ -n "$remote_sha" ] && [ "$remote_sha" != "$ZERO" ] || return 1
  git cat-file -e "$remote_sha" 2>/dev/null || return 1
  git merge-base --is-ancestor "$remote_sha" "$local_sha" 2>/dev/null || return 1
  files="$(git diff --name-only "$remote_sha" "$local_sha")" || return 1
  [ -n "$files" ] || return 1
  while IFS= read -r f; do
    case "$f" in
      docs/*) ;;
      .github/*.md) ;;
      *.md | *.mdx | *.markdown) [ "${f%/*}" = "$f" ] || return 1 ;;
      LICENSE | LICENSE.*) ;;
      *) return 1 ;;
    esac
  done <<<"$files"
  return 0
}
if prepush_doc_only "$REMOTE_SHA" "$LOCAL_SHA"; then
  echo "▶ pre-push (todoist-backlog-scheduler) → $push_to_main: docs-only change — skipping the full gate."
  exit 0
fi

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
