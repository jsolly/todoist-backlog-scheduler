#!/usr/bin/env bash
# Code-only Lambda deploy under the scoped agent-deploy role.
# Locally: export AWS_PROFILE=fleet-deploy (see AGENTS.md). Infra/template
# changes are NOT applied here — they require a full `sam deploy` with admin
# creds on the laptop.
set -euo pipefail
cd "$(dirname "$0")/.."
STACK=todoist-backlog-scheduler
FUNCTIONS=(SchedulerFunction)
export PATH="$PWD/node_modules/.bin:$PATH"
# Resolve aws/sam to the repo-pinned versions (.mise.toml) — guarded; degrades to global without mise
# (rules/tool-versions.md). The node_modules/.bin prepend above is independent (grounds esbuild).
command -v mise >/dev/null 2>&1 && eval "$(mise activate bash --shims)"
# Ground the system CLIs this deploy shells out to: aws/sam are NOT npm deps (the PATH prepend above
# only grounds the local esbuild that `sam build` calls), so fail loud if absent — never a hard-coded
# path, since Homebrew differs by arch (rules/dependency-grounding.md).
command -v sam >/dev/null 2>&1 || { echo "✗ sam CLI not found — brew install aws-sam-cli" >&2; exit 1; }
command -v aws >/dev/null 2>&1 || { echo "✗ aws CLI not found — brew install awscli" >&2; exit 1; }
# Shared fleet gate helpers (for gate_lambda_tag_provenance below). Sourcing has no side effects.
# shellcheck source=/dev/null
source "${DOTAGENTS_GATE_LIB:-$HOME/code/dotagents/gate/gate-lib.sh}" || {
  echo "✗ dotagents gate-lib not found — re-run install-local-agent-runtime.sh." >&2
  exit 1
}
# Reproducible bundle: reinstall exactly the committed lockfile before `sam build` bundles the
# Lambda from gitignored node_modules. This MANUAL code-only path can run from a stale checkout —
# the read-only `main` mirror is never `npm ci`'d in the worktree-first flow — so always reinstall
# (the 2026-06-21 incident was a week-stale node_modules missing a newly-added dep). cwd is repo root.
npm ci
# Plain `sam build` — each repo's samconfig.toml carries template/base_dir settings.
sam build
# The git commit this deploy built from — stamped as the Deploy-Commit tag (with AWS's CodeSha256 as
# Deploy-Sha256) for CodeSha256-based drift detection (scripts/check-deploy-drift.ts). Full SHA.
COMMIT="$(git rev-parse HEAD)"
for logical in "${FUNCTIONS[@]}"; do
  fn=$(aws cloudformation describe-stack-resource \
    --stack-name "$STACK" --logical-resource-id "$logical" \
    --query 'StackResourceDetail.PhysicalResourceId' --output text)
  (cd ".aws-sam/build/$logical" && zip -qr "../$logical.zip" .)
  # Capture CodeSha256 + ARN that update-function-code returns (was discarded to /dev/null), then tag.
  out="$(aws lambda update-function-code \
    --function-name "$fn" --zip-file "fileb://.aws-sam/build/$logical.zip" \
    --query '[CodeSha256, FunctionArn]' --output text)"
  aws lambda wait function-updated-v2 --function-name "$fn"
  read -r _sha _arn <<<"$out"
  gate_lambda_tag_provenance "$_arn" "$_sha" "$COMMIT"
  echo "✓ $logical → $fn ($_sha)"
done
