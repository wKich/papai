# TDD Enforcement Protocol

You MUST follow Red → Green → Refactor strictly. Hooks will block violations automatically.

---

## Phase Rules

### 🔴 Red — Write a failing test first

- Before touching ANY implementation file, write a failing test for the behavior
- The test file MUST exist before the implementation file is created or edited
- The test must actually fail (not just be written) — assert the behavior you're about to build
- Hooks will block impl writes if no test file exists

### 🟢 Green — Minimum code to pass

- Write the simplest implementation that makes the failing test pass
- Do NOT add logic beyond what the test requires
- After every file write, tests are run automatically
- If tests go RED, stop and fix before proceeding

### 🔵 Refactor — Clean up without changing behavior

- You do NOT need new failing tests for pure refactoring
- You MUST keep all existing tests GREEN throughout
- You MUST NOT expand the public API (no new exports, no new parameters)
- You MUST NOT introduce new code paths uncovered by existing tests
- Mutation testing will run — new surviving mutants = new untested logic = BLOCKED

---

## Hard Rules

1. Never touch an implementation file before its test file exists
2. Never proceed past a RED test, even temporarily
3. Never add logic during refactor that existing tests don't exercise
4. If you want to add new functionality during a refactor — stop, go back to Red phase

---

## Environment Variables

| Variable         | Default | Effect                                             |
| ---------------- | ------- | -------------------------------------------------- |
| `TDD_MUTATION=0` | off     | Disable mutation testing (faster, weaker)          |
| `TDD_MUTATION=1` | on      | Enable mutation testing (slower, full enforcement) |

Mutation testing adds ~30–120s per file. Disable during rapid iteration, re-enable before declaring a refactor complete.

---

## Decision Flow

```
Want to write code?
  │
  ├─ Is it a test file?
  │    └─ YES → ✅ Write it (Red phase)
  │
  └─ Is it an implementation file?
       │
       ├─ Does a test file exist?
       │    └─ NO → ❌ BLOCKED: Write the test first
       │
       └─ YES → Write the impl
            │
            ├─ Do tests pass?
            │    └─ NO → ❌ BLOCKED: Fix the regression
            │
            ├─ Did the public API change?
            │    └─ YES → ❌ BLOCKED: Revert or go to Red phase
            │
            └─ Are there new surviving mutants?
                 └─ YES → ❌ BLOCKED: Revert or go to Red phase
```
