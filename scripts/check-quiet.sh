#!/bin/sh
set -euo pipefail

# Create temp directory for capturing outputs
TMPDIR=$(mktemp -d) || { echo "Failed to create temp dir" >&2; exit 1; }
trap 'rm -rf "$TMPDIR"' EXIT

# Define checks
checks=("lint" "typecheck" "format:check" "knip" "test" "duplicates" "mock-pollution")
failed=0

# Run all checks in parallel
for check in "${checks[@]}"; do
  (
    exit_code=0
    bun run "$check" >"$TMPDIR/$check.out" 2>&1 || exit_code=$?
    echo "$exit_code" >"$TMPDIR/$check.exit"
  ) &
done

# Wait for all background jobs
wait

# Check results and display failures
for check in "${checks[@]}"; do
  if [ ! -f "$TMPDIR/$check.exit" ]; then
    failed=$((failed + 1))
    echo ""
    echo "✗ $check failed (no exit file found)"
    continue
  fi
  exit_code=$(cat "$TMPDIR/$check.exit")
  if [ "$exit_code" -ne 0 ]; then
    failed=$((failed + 1))
    echo ""
    echo "✗ $check failed (exit code $exit_code):"
    echo "---"
    cat "$TMPDIR/$check.out"
    echo "---"
  fi
done

# Print summary
total=${#checks[@]}
passed=$((total - failed))
if [ "$failed" -eq 0 ]; then
  echo "✓ All $total checks passed"
  exit 0
else
  echo "✓ $passed/$total checks passed, $failed failed"
  exit 1
fi
