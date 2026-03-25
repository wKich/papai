# Design: Quiet Pre-commit Checks

**Date:** 2025-03-24  
**Status:** Approved  
**Author:** Claude

## Problem

The current pre-commit hook runs `bun check`, which executes 7 checks in parallel (lint, typecheck, format:check, knip, test, duplicates, mock-pollution). This generates excessive output that pollutes the AI Agent context window when everything passes.

## Goal

Suppress success output from pre-commit checks while maintaining parallel execution. Only show output when something fails.

## Design

### Architecture

Create a wrapper script `scripts/check-quiet.sh` that runs all 7 checks in parallel with captured output, displaying only failures plus a minimal summary.

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────┐
│  pre-commit.sh  │────▶│ check-quiet.sh   │────▶│ 7 parallel   │
│                 │     │ (wrapper)        │     │ check jobs   │
└─────────────────┘     └──────────────────┘     └──────────────┘
                                                       │
                                                       ▼
                                                ┌──────────────┐
                                                │ Output only  │
                                                │ on failure   │
                                                └──────────────┘
```

### Components

1. **`scripts/check-quiet.sh`** (new)
   - Runs all 7 checks as background processes
   - Captures stdout/stderr to temporary files per check
   - Waits for all jobs to complete
   - Outputs only failed check results
   - Shows summary line (e.g., "✓ 7/7 checks passed")
   - Returns exit code 1 if any check fails

2. **Modified `scripts/pre-commit.sh`**
   - Replace `bun check` with `./scripts/check-quiet.sh`
   - Keep lint suppression check as-is

### Behavior

**Success case:**

```
✓ All 7 checks passed
```

**Failure case:**

```
✗ lint failed:
[full lint output]

✗ typecheck failed:
[full typecheck output]

✓ 5/7 checks passed, 2 failed
```

### Parallelism Strategy

Use POSIX shell background processes with `&` and `wait`:

```bash
run_check() {
  local name=$1
  shift
  "$@" >"$tmp_dir/$name.out" 2>&1
  echo $? >"$tmp_dir/$name.exit"
}

run_check lint bun run lint &
run_check typecheck bun run typecheck &
# ... etc

wait
```

### Error Handling

- Each check runs in a subshell to isolate failures
- Capture exit codes for each check
- After all complete, iterate through results
- Print output only for checks with non-zero exit codes
- Exit with code 1 if any check failed

### Testing

The implementation can be tested by:

1. Running `scripts/check-quiet.sh` directly and verifying output
2. Making a commit and verifying pre-commit behavior
3. Intentionally breaking a file to verify failure output appears

## Files Modified

- `scripts/pre-commit.sh` - Replace `bun check` with wrapper call

## Files Created

- `scripts/check-quiet.sh` - New wrapper script

## Integration

The `prepare` script in package.json will continue to work unchanged as it only copies `scripts/pre-commit.sh` to `.git/hooks/`.

## Success Criteria

- [ ] Running pre-commit hook with all checks passing shows ≤5 lines of output
- [ ] Failed checks show full output for debugging
- [ ] Parallel execution is maintained (no significant slowdown)
- [ ] Exit code is 0 on success, 1 on any failure
