#!/bin/sh
set -euo pipefail

# Calculate script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Check for lint suppression comments in modified files
"$REPO_ROOT/.claude/hooks/check-no-lint-suppression.sh"

"$SCRIPT_DIR/check-quiet.sh" --staged
