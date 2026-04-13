#!/bin/bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

"$REPO_ROOT/scripts/check.sh" --staged
