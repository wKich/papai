# Staged-Only Pre-commit Checks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `--staged` flag to check-quiet.sh to run only lint/typecheck/format on staged files, skipping project-wide checks.

**Architecture:** Modify `scripts/check-quiet.sh` to detect `--staged` flag, filter staged files by extension, and run only relevant checks in parallel. Update `scripts/pre-commit.sh` to pass `--staged` flag.

**Tech Stack:** POSIX shell scripting, bun package manager

---

## Task 1: Modify check-quiet.sh to support --staged flag

**Files:**

- Modify: `scripts/check-quiet.sh:1-52`

**Context:** Current check-quiet.sh runs all 7 checks unconditionally. We need to add logic to detect `--staged` flag and run only lint/typecheck/format on staged files.

**Step 1: Read current check-quiet.sh**

Verify current implementation at `scripts/check-quiet.sh`.

**Step 2: Add staged file detection logic**

Replace the entire `scripts/check-quiet.sh` with this enhanced version:

```bash
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
```

**Step 3: Test both modes**

Test without flag (all checks):

```bash
./scripts/check-quiet.sh
```

Expected: Runs all 7 checks, shows summary.

Test with --staged flag:

```bash
./scripts/check-quiet.sh --staged
```

Expected: Runs only lint/typecheck/format on staged files (or "No relevant staged files" if none).

**Step 4: Commit**

```bash
git add scripts/check-quiet.sh
rtk git commit -m "feat: add --staged flag to check-quiet.sh for staged-only checks"
```

---

## Task 2: Update pre-commit.sh to use --staged flag

**Files:**

- Modify: `scripts/pre-commit.sh:11`

**Context:** The pre-commit hook currently calls check-quiet.sh without any flags, running all checks. We need to update it to pass `--staged`.

**Step 1: Modify pre-commit.sh**

Change line 11 from:

```bash
"$SCRIPT_DIR/check-quiet.sh"
```

To:

```bash
"$SCRIPT_DIR/check-quiet.sh" --staged
```

**Step 2: Test the hook**

```bash
./scripts/pre-commit.sh
```

Expected: Shows "ℹ Checking staged files: ..." and runs only 3 checks.

**Step 3: Commit**

```bash
git add scripts/pre-commit.sh
rtk git commit -m "feat: run staged-only checks in pre-commit hook"
```

---

## Task 3: Test complete workflow

**Files:**

- Test: Manual testing

**Step 1: Test with staged files**

```bash
# Make a small change
echo "// test" >> src/index.ts
git add src/index.ts

# Run pre-commit
./scripts/pre-commit.sh
```

Expected:

- Shows "ℹ Checking staged files: src/index.ts"
- Runs only 3 checks (lint, typecheck, format:check)
- Shows "✓ All 3 checks passed"

**Step 2: Test with no relevant staged files**

```bash
# Reset and add a non-code file
git reset HEAD src/index.ts
git checkout -- src/index.ts
echo "test" > test.txt
git add test.txt

# Run pre-commit
./scripts/pre-commit.sh
```

Expected:

- Shows "ℹ No relevant staged files to check"
- Exits with code 0

**Step 3: Test backward compatibility**

```bash
# Run without --staged flag
./scripts/check-quiet.sh
```

Expected:

- Runs all 7 checks
- Shows "✓ All 7 checks passed"

**Step 4: Test bun check-quiet still works**

```bash
bun run check-quiet
```

Expected:

- Runs all 7 checks
- Shows "✓ All 7 checks passed"

**Step 5: Clean up test file**

```bash
git reset HEAD test.txt
rm test.txt
```

**Step 6: Commit test results (optional)**

If all tests pass, no commit needed. If issues found, fix them first.

---

## Task 4: Update documentation

**Files:**

- Modify: `CLAUDE.md:28`

**Context:** Need to document the new `--staged` behavior.

**Step 1: Update CLAUDE.md**

Add after line 28:

```markdown
- `bun check-quiet --staged` — run lint/typecheck/format on staged files only (fast, used by pre-commit hook)
```

**Step 2: Commit**

```bash
git add CLAUDE.md
rtk git commit -m "docs: document check-quiet --staged flag"
```

---

## Success Criteria

- [ ] `./scripts/check-quiet.sh --staged` runs only lint/typecheck/format
- [ ] `./scripts/check-quiet.sh` (no flag) runs all 7 checks (backward compatible)
- [ ] Pre-commit hook uses `--staged` flag
- [ ] When no relevant staged files, shows "No relevant staged files to check" and exits 0
- [ ] Only staged files with extensions .ts, .tsx, .js, .jsx, .json, .md are checked
- [ ] Execution time is under 5 seconds for small changes
- [ ] Documentation updated
