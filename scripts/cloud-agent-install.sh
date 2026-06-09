#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=/dev/null
# Fleet cloud-install lib exists only when the cloud bridge is wired (currently deferred).
if [ -f "$REPO_ROOT/.agents/scripts/cloud-install-lib.sh" ]; then
  source "$REPO_ROOT/.agents/scripts/cloud-install-lib.sh"
fi

if type use_node_for_cursor_cloud >/dev/null 2>&1; then
  use_node_for_cursor_cloud
else
  echo "fleet cloud-install-lib absent; using VM default Node (cloud bridge deferred)" >&2
fi
npm ci
install_sam

echo "cloud-agent-install: OK (node $(node -v))"
