#!/bin/sh
set -euo pipefail

# Calculate script directory and repo root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# Check for lint suppression comments in modified files
"$REPO_ROOT/.claude/hooks/check-no-lint-suppression.sh"

"$REPO_ROOT/scripts/check.sh" --staged
