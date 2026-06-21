#!/usr/bin/env bash
# Full production deploy: builds the Lambda bundle and runs the SAM deploy with admin
# SSO creds. This is the ONLY path that sets GitSha (and thus the GIT_SHA runtime env);
# the routine code-only path (aws/deploy-code.sh) leaves it untouched. Infra/template
# changes require this full deploy. The deploy secret + dynamic GitSha come from
# .env.local via sam-params.sh.
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
# Assemble SAM_PARAMS (incl. the dynamic GitSha) from .env.local. `--parameter-overrides`
# REPLACES samconfig's parameter_overrides wholesale, so sam-params.sh re-lists every param
# samconfig supplied — see its comment. This is the only path that sets GIT_SHA.
# shellcheck source=./sam-params.sh
source "$SCRIPT_DIR/sam-params.sh"
sam deploy --parameter-overrides "${SAM_PARAMS[@]}"
