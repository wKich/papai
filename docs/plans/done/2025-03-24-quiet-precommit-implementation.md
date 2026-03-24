# Quiet Pre-commit Checks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a wrapper script that runs pre-commit checks in parallel but only shows output for failures.

**Architecture:** Create `scripts/check-quiet.sh` as a POSIX shell script that runs 7 checks (lint, typecheck, format:check, knip, test, duplicates, mock-pollution) in parallel using background processes, captures their output, and displays only failed results plus a summary line.

**Tech Stack:** POSIX shell scripting, bun package manager

---

## Task 1: Create the quiet check wrapper script

**Files:**

- Create: `scripts/check-quiet.sh`
- Modify: `scripts/pre-commit.sh:7`

**Context:** The current `scripts/pre-commit.sh` runs `bun check` which outputs everything. We need a wrapper that suppresses success output. The checks are: lint, typecheck, format:check, knip, test, duplicates, mock-pollution.

**Step 1: Create the wrapper script**

Create `scripts/check-quiet.sh`:

```bash
#!/bin/sh
set -e

# Create temp directory for output capture
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

# Define checks: name|command
checks="lint|bun run lint
typecheck|bun run typecheck
format:check|bun run format:check
knip|bun run knip
test|bun run test
duplicates|bun run duplicates
mock-pollution|bun run mock-pollution"

# Function to run a single check and capture output
run_check() {
    local name=$1
    local cmd=$2
    local exit_file="$tmp_dir/${name}.exit"
    local out_file="$tmp_dir/${name}.out"

    # Run command, capture output and exit code
    if eval "$cmd" >"$out_file" 2>&1; then
        echo 0 >"$exit_file"
    else
        echo $? >"$exit_file"
    fi
}

# Run all checks in parallel
echo "$checks" | while IFS='|' read -r name cmd; do
    [ -n "$name" ] && run_check "$name" "$cmd" &
done

# Wait for all background jobs
wait

# Collect results
failed=0
failed_names=""

for name in lint typecheck format:check knip test duplicates mock-pollution; do
    exit_file="$tmp_dir/${name}.exit"
    out_file="$tmp_dir/${name}.out"

    if [ -f "$exit_file" ]; then
        exit_code=$(cat "$exit_file")
        if [ "$exit_code" -ne 0 ]; then
            failed=$((failed + 1))
            failed_names="$failed_names $name"

            echo ""
            echo "✗ $name failed:"
            cat "$out_file"
        fi
    fi
done

# Print summary
total=7
passed=$((total - failed))

if [ $failed -eq 0 ]; then
    echo "✓ All $total checks passed"
    exit 0
else
    echo ""
    echo "✓ $passed/$total checks passed, $failed failed"
    exit 1
fi
```

**Step 2: Make the script executable**

```bash
chmod +x scripts/check-quiet.sh
```

**Step 3: Modify pre-commit.sh to use the wrapper**

Modify `scripts/pre-commit.sh` line 7:

```bash
#!/bin/sh
set -e

# Check for lint suppression comments in modified files
.claude/hooks/check-no-lint-suppression.sh

# Run checks quietly (only show failures)
./scripts/check-quiet.sh
```

**Step 4: Test the wrapper directly**

```bash
./scripts/check-quiet.sh
```

Expected: Runs all 7 checks, shows only "✓ All 7 checks passed" if everything passes, or shows failed check output if something fails.

**Step 5: Commit**

```bash
git add scripts/check-quiet.sh scripts/pre-commit.sh
git commit -m "feat: add quiet pre-commit check wrapper"
```

---

## Task 2: Add the new script to package.json

**Files:**

- Modify: `package.json:32`

**Context:** The new `check-quiet` script should be available as a bun command for manual use.

**Step 1: Add script entry**

Add to `package.json` scripts section (around line 32, after "fix"):

```json
"check-quiet": "./scripts/check-quiet.sh",
```

**Step 2: Test it works**

```bash
bun run check-quiet
```

Expected: Same behavior as running `./scripts/check-quiet.sh` directly.

**Step 3: Commit**

```bash
git add package.json
git commit -m "feat: add check-quiet script to package.json"
```

---

## Task 3: Test the complete pre-commit flow

**Files:**

- Test: `.git/hooks/pre-commit` (auto-generated from scripts/pre-commit.sh)

**Step 1: Run pre-commit hook directly**

```bash
./scripts/pre-commit.sh
```

Expected: Shows lint suppression check (should be silent if no issues), then runs check-quiet showing only summary or failures.

**Step 2: Test with a deliberate failure**

Create a temporary lint error:

```bash
echo "const x = 1" > /tmp/test-lint.ts
bun run lint /tmp/test-lint.ts 2>/dev/null || true
```

Then modify a tracked file with the same error:

```bash
echo "const y = 2" >> src/index.ts
git add src/index.ts
```

Run pre-commit:

```bash
./scripts/pre-commit.sh
```

Expected: Should show lint errors, not show passing checks output, and exit with code 1.

**Step 3: Clean up test file**

```bash
git checkout -- src/index.ts
git reset HEAD src/index.ts
rm /tmp/test-lint.ts 2>/dev/null || true
```

**Step 4: Verify clean run**

```bash
./scripts/pre-commit.sh
```

Expected: Shows "✓ All 7 checks passed" (plus any lint suppression warnings if applicable).

**Step 5: Commit test verification**

No commit needed for this task - it was testing.

---

## Task 4: Update documentation

**Files:**

- Modify: `CLAUDE.md:26`

**Step 1: Update commands section in CLAUDE.md**

Add `check-quiet` to the commands list (after line 26):

```markdown
- `bun check` — run all checks in parallel (lint, typecheck, format:check, knip, test, duplicates, mock-pollution)
- `bun check-quiet` — run all checks, suppressing success output (used by pre-commit hook)
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document check-quiet command in CLAUDE.md"
```

---

## Success Criteria

- [ ] Running `bun check-quiet` with all checks passing shows ≤3 lines of output
- [ ] Running `bun check-quiet` with failures shows only the failed check output + summary
- [ ] Pre-commit hook uses the quiet wrapper
- [ ] Parallel execution is maintained (comparable speed to `bun check`)
- [ ] Exit code is 0 on success, 1 on any failure
