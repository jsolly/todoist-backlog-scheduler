#!/usr/bin/env bash
# Source this to export SAM_PARAMS from ../.env.local — the single source of the
# .env.local -> SAM parameter translation for the full production deploy (aws/deploy.sh).
#
# Mirrors family-memory/aws/sam-params.sh: every value comes from the gitignored
# .env.local (never committed). Deploy provenance is no longer a SAM parameter — it
# rides as the Deploy-Sha256/Deploy-Commit function tags stamped after each deploy
# (aws/deploy.sh re-tag step; scripts/check-deploy-drift.ts audits them).
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

# The Todoist API key is NO LONGER a deploy parameter — the function fetches it at
# runtime from the SSM SecureString /todoist-backlog-scheduler/api-key (see
# aws/template.yaml + src/shared/secrets.ts). Provision/rotate it out of band:
#   aws ssm put-parameter --name /todoist-backlog-scheduler/api-key \
#     --type SecureString --value <key> --overwrite --region us-east-1
# (.env.local's TODOIST_API_KEY is still used for the local `npm run scheduler` CLI.)

# These mirror samconfig.toml's [default.deploy.parameters] parameter_overrides
# (MaxTasksPerDay + AlertTopicArn). Passing `--parameter-overrides` REPLACES
# samconfig's set wholesale (it does not merge), so EVERY param samconfig supplied
# must be listed here or the deploy drops it.
SAM_PARAMS=(
  "AlertTopicArn=/shared-infra/alert-topic-arn"
  "MaxTasksPerDay=${MAX_TASKS_PER_DAY:-5}"
)
export SAM_PARAMS
