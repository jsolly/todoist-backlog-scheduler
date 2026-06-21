#!/usr/bin/env bash
# Source this to export SAM_PARAMS from ../.env.local — the single source of the
# .env.local -> SAM parameter translation for the full production deploy (aws/deploy.sh).
#
# Mirrors family-memory/aws/sam-params.sh: every value comes from the gitignored
# .env.local (never committed), so the dynamic GitSha can ride alongside the secret.
# GitSha stamps every structured log line (src/shared/logging.ts) so a prod error is
# traceable to the exact source via `git show <sha>:<file>`.
set -euo pipefail

_PARAMS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_ENV_FILE="${ENV_FILE:-$_PARAMS_DIR/../.env.local}"

if [ ! -f "$_ENV_FILE" ]; then
  echo "Error: .env.local not found at $_ENV_FILE" >&2
  exit 1
fi

# shellcheck disable=SC2163
while IFS='=' read -r _key _value; do
  [[ -z "$_key" || "$_key" == \#* ]] && continue
  # Skip AWS_* credential/region selectors. This full infra deploy must run under the operator's
  # admin session; if .env.local ever sets AWS_PROFILE (e.g. fleet-deploy for the code-only path,
  # like the sibling repos), importing it here would clobber that session and the deploy would fail
  # closed on cloudformation:UpdateStack. An exported env AWS_PROFILE wins over samconfig's profile=,
  # so this guard — not the samconfig profile — is what keeps the deploy on the admin creds. SAM
  # still reads creds from the operator's environment/SSO. (Matches family-memory's sam-params.sh.)
  [[ "$_key" == AWS_* ]] && continue
  export "$_key=$_value"
done < "$_ENV_FILE"

: "${TODOIST_API_KEY:?TODOIST_API_KEY not set in .env.local}"

_GIT_SHA="$(git -C "$_PARAMS_DIR/.." rev-parse --short HEAD 2>/dev/null || echo unknown)"

# These mirror samconfig.toml's [default.deploy.parameters] parameter_overrides
# (MaxTasksPerDay + AlertTopicArn + TodoistApiKey) plus the dynamic GitSha. Passing
# `--parameter-overrides` REPLACES samconfig's set wholesale (it does not merge), so
# EVERY param samconfig supplied must be listed here or the deploy drops it.
SAM_PARAMS=(
  "AlertTopicArn=/shared-infra/alert-topic-arn"
  "MaxTasksPerDay=${MAX_TASKS_PER_DAY:-5}"
  "TodoistApiKey=$TODOIST_API_KEY"
  "GitSha=$_GIT_SHA"
)
export SAM_PARAMS
