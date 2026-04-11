#!/bin/bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

if [ "$#" -eq 0 ]; then
  echo "Usage: bun lint:agent-strict -- <paths...>" >&2
  exit 1
fi

cd "$REPO_ROOT"
exec "$REPO_ROOT/node_modules/.bin/oxlint" --config "$REPO_ROOT/.oxlintrc.agent-strict.json" "$@"
