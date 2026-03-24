#!/bin/bash
set -euo pipefail

# Check if in git repo
if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo "Error: Not in a git repository" >&2
  exit 1
fi

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

# Sanitize check names for safe temp filenames (replace : with _)
safe_name() { echo "${1//:/_}"; }

if [ "$STAGED_MODE" = true ]; then
  # Get staged files into array
  staged_files=()
  while IFS= read -r file; do
    [ -n "$file" ] && staged_files+=("$file")
  done < <(git diff --staged --name-only --diff-filter=ACM 2>/dev/null || true)

  # Build array of relevant files
  relevant_files=()
  for file in "${staged_files[@]+${staged_files[@]}}"; do
    [ -z "$file" ] && continue
    case "$file" in
      *.ts|*.tsx|*.js|*.jsx|*.json|*.md)
        relevant_files+=("$file")
        ;;
    esac
  done

  # Check if array is empty
  if [ ${#relevant_files[@]} -eq 0 ]; then
    echo "ℹ No relevant staged files to check"
    exit 0
  fi

  echo "ℹ Checking staged files: ${relevant_files[*]}"

  # Run only lint, typecheck, format on staged files
  checks=("lint" "typecheck" "format:check")
  failed=0

  # Run lint on staged files
  (
    exit_code=0
    bunx oxlint --config .oxlintrc.json "${relevant_files[@]}" >"$TMPDIR/lint.out" 2>&1 || exit_code=$?
    echo "$exit_code" >"$TMPDIR/lint.exit"
  ) &
  lint_pid=$!

  # Run typecheck (project-wide, but fast)
  (
    exit_code=0
    bun run typecheck >"$TMPDIR/typecheck.out" 2>&1 || exit_code=$?
    echo "$exit_code" >"$TMPDIR/typecheck.exit"
  ) &
  typecheck_pid=$!

  # Run format:check on staged files
  (
    exit_code=0
    bunx oxfmt --check "${relevant_files[@]}" >"$TMPDIR/format_check.out" 2>&1 || exit_code=$?
    echo "$exit_code" >"$TMPDIR/format_check.exit"
  ) &
  format_pid=$!

  # Wait for all background jobs
  wait "$lint_pid"
  wait "$typecheck_pid"
  wait "$format_pid"

  # Check results and display failures
  for check in "${checks[@]}"; do
    fname=$(safe_name "$check")
    if [ ! -f "$TMPDIR/$fname.exit" ]; then
      failed=$((failed + 1))
      echo ""
      echo "✗ $check failed (no exit file found)"
      continue
    fi
    exit_code=$(cat "$TMPDIR/$fname.exit")
    if [ "$exit_code" -ne 0 ]; then
      failed=$((failed + 1))
      echo ""
      echo "✗ $check failed (exit code $exit_code):"
      echo "---"
      cat "$TMPDIR/$fname.out"
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
  pids=()

  # Run all checks in parallel
  for check in "${checks[@]}"; do
    fname=$(safe_name "$check")
    (
      exit_code=0
      bun run "$check" >"$TMPDIR/$fname.out" 2>&1 || exit_code=$?
      echo "$exit_code" >"$TMPDIR/$fname.exit"
    ) &
    pids+=($!)
  done

  # Wait for all background jobs
  for pid in "${pids[@]}"; do
    wait "$pid"
  done

  # Check results and display failures
  for check in "${checks[@]}"; do
    fname=$(safe_name "$check")
    if [ ! -f "$TMPDIR/$fname.exit" ]; then
      failed=$((failed + 1))
      echo ""
      echo "✗ $check failed (no exit file found)"
      continue
    fi
    exit_code=$(cat "$TMPDIR/$fname.exit")
    if [ "$exit_code" -ne 0 ]; then
      failed=$((failed + 1))
      echo ""
      echo "✗ $check failed (exit code $exit_code):"
      echo "---"
      cat "$TMPDIR/$fname.out"
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
