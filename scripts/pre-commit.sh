#!/bin/sh
set -e

# Check for lint suppression comments in modified files
.claude/hooks/check-no-lint-suppression.sh

bun run format
bun run lint:fix

git add -u
