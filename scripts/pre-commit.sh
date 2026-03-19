#!/bin/sh
set -e

# Check for lint suppression comments in modified files
.claude/hooks/check-no-lint-suppression.sh

bun run format
bun run lint:fix

# Run type check and unit tests
echo "Running type check..."
bun run typecheck

echo "Running unit tests..."
bun run test

# Run security scan (non-blocking if semgrep is unavailable)
echo "Running security scan..."
SECURITY_EXIT=0
bun run security || SECURITY_EXIT=$?
if [ "$SECURITY_EXIT" -eq 1 ]; then
    echo "❌ Security scan found issues. Fix them before committing."
    exit 1
elif [ "$SECURITY_EXIT" -ge 2 ]; then
    echo "⚠️  Security scan could not run (semgrep unavailable). Skipping."
fi

git add -u
