# Design: Staged-Only Pre-commit Checks

**Date:** 2025-03-24  
**Status:** Approved  
**Author:** Claude

## Problem

The current `check-quiet.sh` script runs all 7 checks (lint, typecheck, format:check, knip, test, duplicates, mock-pollution) against the entire codebase. While the output is suppressed for passing checks, the execution time is still slow because it analyzes the whole project. This is unnecessary for pre-commit hooks where we only need to validate the files being committed.

## Goal

Modify the pre-commit hook to run checks only on staged files for faster feedback, while keeping project-wide checks in CI.

## Research

Investigated available tools:

1. **lint-staged** (14.5k stars) - Industry standard npm package
   - Mature, handles edge cases
   - Adds dependency
   - Still cannot make knip/test analyze partial files correctly

2. **lint-staged.sh** - Minimal shell script version
   - Single file, no dependencies
   - Less flexible

3. **Custom solution** - Modify existing `check-quiet.sh`
   - No new dependencies
   - Tailored to our exact needs
   - Reuses existing code

## Decision

Use **Option A (Custom solution)** - Add `--staged` flag to `check-quiet.sh` that:

- Runs only lint/typecheck/format on staged files
- Skips project-wide checks (knip, test, duplicates, mock-pollution)
- Updates `pre-commit.sh` to use `--staged` flag

Rationale:

- Fast pre-commit execution
- No new dependencies
- Project-wide checks remain in CI
- Minimal output maintained

## Design

### Architecture

```
pre-commit.sh
    │
    ▼
check-quiet.sh --staged
    │
    ├─ Get staged files: git diff --staged --name-only --diff-filter=ACM
    │
    ├─ Filter relevant files (*.ts, *.tsx, *.js, *.json)
    │
    ├─ Run in parallel:
    │   ├─ lint: oxlint <staged-files>
    │   ├─ typecheck: tsgo --noEmit (project-wide, but fast)
    │   └─ format:check: oxfmt --check <staged-files>
    │
    └─ Show results (✓ or ✗ per check)
```

### Components

**1. Modified `scripts/check-quiet.sh`**

- Accept optional `--staged` flag
- When `--staged` is passed:
  - Get staged files list
  - Filter to relevant extensions
  - Run only lint/typecheck/format
  - Skip knip/test/duplicates/mock-pollution
- When no flag: run all checks (backward compatible)

**2. Modified `scripts/pre-commit.sh`**

- Pass `--staged` flag to check-quiet.sh
- Keep lint suppression check as-is

### Behavior

**With staged files (src/utils.ts):**

```
✓ lint passed (1 file)
✓ typecheck passed
✓ format:check passed
✓ All 3 checks passed
```

**With no staged files:**

```
(no checks run, exit 0)
```

**With failures:**

```
✗ lint failed:
[error output]

✓ 2/3 checks passed, 1 failed
```

### Implementation Notes

- Use `git diff --staged --name-only --diff-filter=ACM` to get staged files
- Filter for: .ts, .tsx, .js, .jsx, .json, .md
- Typecheck runs on whole project (tsgo doesn't support file filtering), but is fast
- If no relevant staged files, skip all checks and exit 0

### Success Criteria

- [ ] Pre-commit runs in under 5 seconds for small changes
- [ ] Only lint/typecheck/format run on pre-commit
- [ ] Project-wide checks (knip/test/etc) skipped in pre-commit
- [ ] Backward compatible: `bun check-quiet` still runs all checks
- [ ] Minimal output maintained (only failures shown)
- [ ] Works correctly when no files are staged
- [ ] CI still runs full `bun check` suite
