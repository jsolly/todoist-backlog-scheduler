#!/usr/bin/env bash
# Full production deploy: builds the Lambda bundle and runs the SAM deploy with admin
# SSO creds. Infra/template changes require this full deploy; the routine code-only path
# is aws/deploy-code.sh. The deploy secret comes from .env.local via sam-params.sh, and
# deploy provenance is stamped as Deploy-Sha256/Deploy-Commit function tags afterward
# (the re-tag step below; both deploy paths share gate_lambda_tag_provenance).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# samconfig.toml lives at the repo root and carries template_file/base_dir (both
# repo-root-relative), so sam build/deploy must run from here.
cd "$REPO_ROOT"
# Resolve aws/sam to the repo-pinned versions (.mise.toml) — guarded; degrades to global without mise
# (rules/tool-versions.md).
command -v mise >/dev/null 2>&1 && eval "$(mise activate bash --shims)"
# Ground the system CLIs this deploy shells out to: aws/sam are NOT npm deps — fail loud if absent,
# never a hard-coded path (Homebrew differs by arch) — rules/dependency-grounding.md.
command -v sam >/dev/null 2>&1 || { echo "✗ sam CLI not found — brew install aws-sam-cli" >&2; exit 1; }
command -v aws >/dev/null 2>&1 || { echo "✗ aws CLI not found — brew install awscli" >&2; exit 1; }
# Reproducible bundle: reinstall exactly the committed lockfile before `sam build` bundles the
# Lambda from gitignored node_modules. This MANUAL path can run from a stale checkout — the
# read-only `main` mirror is never `npm ci`'d in the worktree-first flow — so always reinstall
# (the 2026-06-21 incident was a week-stale node_modules missing a newly-added dep).
npm ci
# SAM's esbuild integration resolves esbuild from PATH; prepend the repo node_modules/.bin so we
# use the pinned version, not whatever's global.
export PATH="$REPO_ROOT/node_modules/.bin:$PATH"
sam build
# Assemble SAM_PARAMS from .env.local. `--parameter-overrides` REPLACES samconfig's
# parameter_overrides wholesale, so sam-params.sh re-lists every param samconfig
# supplied — see its comment.
# shellcheck source=./sam-params.sh
source "$SCRIPT_DIR/sam-params.sh"

# Deploy-after-landing: a full SAM deploy ships Lambda code, so deploy ONLY what has landed on
# origin/main — never the local tree before the ref lands (the same invariant the code-only
# deploy:code path enforces; rules/agent-cloud-access.md, docs/plans/2026-06-24-deploy-after-landing.md).
# gate-lib is sourced here and reused for the provenance tagging after the deploy. Runs after the
# reversible npm ci + sam build, before the irreversible sam deploy.
# shellcheck source=/dev/null
source "${DOTAGENTS_GATE_LIB:-$HOME/code/dotagents/gate/gate-lib.sh}" || {
  echo "✗ dotagents gate-lib not found (expected ~/code/dotagents/gate/gate-lib.sh) — re-run install-local-agent-runtime.sh." >&2
  exit 1
}
gate_require_landed main

sam deploy --parameter-overrides "${SAM_PARAMS[@]}"

# Re-stamp Deploy-Sha256/Deploy-Commit on every function. A full SAM deploy rebuilds the bundle
# (→ a new CodeSha256) through CloudFormation but does NOT run aws/deploy-code.sh's per-function tag
# step, so without this the provenance tags desync from live code and scripts/check-deploy-drift.ts
# false-fires its INTEGRITY check on this legitimate, on-pipeline deploy. Same two tags the code-only
# deploy writes; reads each function's post-deploy CodeSha256 from list-functions (no hardcoded
# function list to drift from the template). Fail-closed: set -e + gate_lambda_tag_provenance abort
# if tagging can't complete (a stale tag would make the audit lie). gate-lib is already sourced
# above (before the landing guard).
_commit="$(git rev-parse HEAD)"
# No trailing hyphen: the function's explicit template FunctionName is exactly
# "todoist-backlog-scheduler" (no CFN suffix), so the prefix must match that bare name.
_fns="$(aws lambda list-functions \
  --query "Functions[?starts_with(FunctionName, 'todoist-backlog-scheduler')].[FunctionName, CodeSha256, FunctionArn]" \
  --output text)"
[ -n "$_fns" ] || { echo "✗ no todoist-backlog-scheduler* functions found to tag after deploy" >&2; exit 1; }
echo "• stamp deploy provenance tags (Deploy-Sha256 / Deploy-Commit)"
while read -r _name _sha _arn; do
  [ -n "$_name" ] || continue
  gate_lambda_tag_provenance "$_arn" "$_sha" "$_commit"
  echo "  ✓ $_name ($_sha)"
done <<<"$_fns"
