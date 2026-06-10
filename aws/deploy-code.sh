#!/usr/bin/env bash
# Code-only Lambda deploy under the scoped agent-deploy role.
# Locally: export AWS_PROFILE=fleet-deploy (see AGENTS.md). Cloud agents get
# credentials injected. Infra/template changes are NOT applied here — they
# require a full `sam deploy` with admin creds on the laptop.
set -euo pipefail
cd "$(dirname "$0")/.."
STACK=todoist-backlog-scheduler
FUNCTIONS=(SchedulerFunction)
export PATH="$PWD/node_modules/.bin:$PATH"
# Plain `sam build` — each repo's samconfig.toml carries template/base_dir settings.
sam build
for logical in "${FUNCTIONS[@]}"; do
  fn=$(aws cloudformation describe-stack-resource \
    --stack-name "$STACK" --logical-resource-id "$logical" \
    --query 'StackResourceDetail.PhysicalResourceId' --output text)
  (cd ".aws-sam/build/$logical" && zip -qr "../$logical.zip" .)
  aws lambda update-function-code \
    --function-name "$fn" --zip-file "fileb://.aws-sam/build/$logical.zip" >/dev/null
  aws lambda wait function-updated-v2 --function-name "$fn"
  echo "✓ $logical → $fn"
done
