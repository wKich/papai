#!/bin/sh
set -euo pipefail

# Parse arguments
STAGED_MODE=false
for arg in "$@"; do
  if [ "$arg" = "--staged" ]; then
    STAGED_MODE=true
  fi
done

# Create temp directory for capturing outputs
TMPDIR=$(mktemp -d) || { echo "Failed to create temp dir" >&2; exit 1; }
trap 'rm -rf "$TMPDIR"' EXIT

if [ "$STAGED_MODE" = true ]; then
  # Get staged files
  staged_files=$(git diff --staged --name-only --diff-filter=ACM 2>/dev/null || true)

  # Filter to relevant file types
  relevant_files=""
  for file in $staged_files; do
    case "$file" in
      *.ts|*.tsx|*.js|*.jsx|*.json|*.md)
        relevant_files="$relevant_files $file"
        ;;
    esac
  done

  # Trim leading space
  relevant_files=$(echo "$relevant_files" | sed 's/^ *//')

  if [ -z "$relevant_files" ]; then
    echo "ℹ No relevant staged files to check"
    exit 0
  fi

  echo "ℹ Checking staged files: $relevant_files"

  # Run only lint, typecheck, format on staged files
  checks=("lint" "typecheck" "format:check")
  failed=0

  # Run lint on staged files
  (
    exit_code=0
    # shellcheck disable=SC2086
    bun run lint -- $relevant_files >"$TMPDIR/lint.out" 2>&1 || exit_code=$?
    echo "$exit_code" >"$TMPDIR/lint.exit"
  ) &

  # Run typecheck (project-wide, but fast)
  (
    exit_code=0
    bun run typecheck >"$TMPDIR/typecheck.out" 2>&1 || exit_code=$?
    echo "$exit_code" >"$TMPDIR/typecheck.exit"
  ) &

  # Run format:check on staged files
  (
    exit_code=0
    # shellcheck disable=SC2086
    bun run format:check -- $relevant_files >"$TMPDIR/format:check.out" 2>&1 || exit_code=$?
    echo "$exit_code" >"$TMPDIR/format:check.exit"
  ) &

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
else
  # Original behavior: run all checks
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
fi
