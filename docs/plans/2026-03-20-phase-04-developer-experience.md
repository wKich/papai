# Phase 04: Developer Experience — Development Plan

**Created**: 2026-03-20  
**Scope**: User stories from `docs/user-stories/phase-04-developer-experience.md`  
**Runtime**: Bun  
**Test runner**: `bun:test`  
**Linter**: oxlint (no `eslint-disable`, no `@ts-ignore`)

---

## Epic Overview

- **Business Value**: Contributors receive automated quality feedback on every interaction with the repository — on every push and every pull request — without depending on manual reviewer attention. The codebase has a comprehensive, verifiable test safety net covering all LLM-callable tool modules.
- **Success Metrics**:
  - Format, lint, and type errors block merging on every PR to `master`
  - Every push to any branch triggers CI validation within the CI interface
  - All 30 tool wrapper modules have at least one unit test covering the `execute` path
  - The test suite contains 95 or more passing tests on a clean checkout
  - Test output identifies the module each test belongs to via `describe` block names
- **Priority**: High — contributor enablement and quality gate completeness
- **Timeline**: 1 day

---

## Current State Audit

### What is already in place

| Area                                                                                                     | Status                      |
| -------------------------------------------------------------------------------------------------------- | --------------------------- |
| `pull_request: branches: [master]` CI trigger running `bun check`                                        | ✅ Complete                 |
| `bun check` runs lint, typecheck, format:check, knip, tests, security in parallel                        | ✅ Complete                 |
| SARIF upload to GitHub Security tab (semgrep)                                                            | ✅ Complete                 |
| 637 unit tests across 41 files — all passing                                                             | ✅ Exceeds 95-test baseline |
| Tool tests in `tests/tools/` with named `describe` blocks per module                                     | ✅ Complete                 |
| Tests for 28 of 30 tool modules (task, project, comment, label, status, task-label, task-relation tools) | ✅ Complete                 |

### Confirmed gaps (mapped to user stories)

| Gap                                                                                                    | Story | File(s)                                     |
| ------------------------------------------------------------------------------------------------------ | ----- | ------------------------------------------- |
| CI `push` trigger restricted to `branches: [master]` — feature branch pushes do not trigger validation | 2     | `.github/workflows/ci.yml`                  |
| `makeDeleteTaskTool` (`src/tools/delete-task.ts`) has no unit tests                                    | 3, 4  | `tests/tools/task-tools.test.ts`            |
| `checkConfidence` / `confidenceField` (`src/tools/confirmation-gate.ts`) has no unit tests             | 3, 4  | `tests/tools/` (no file covers this module) |

### User story status summary

| Story                                 | Status               | Work Required                 |
| ------------------------------------- | -------------------- | ----------------------------- |
| US1: CI checks on PRs to master       | ✅ Already satisfied | None                          |
| US2: CI validation on every push      | ⚠️ Gap               | 1-line change to `ci.yml`     |
| US3: Unit tests for all tool wrappers | ⚠️ Gap               | Tests for 2 uncovered modules |
| US4: 95+ tests baseline (637 passing) | ✅ Already satisfied | None                          |

---

## Technical Architecture

### CI Pipeline (existing, unchanged except trigger)

```
GitHub event (push or pull_request)
  └─ jobs.check
       └─ bun check (parallel)
            ├─ bun lint          (oxlint)
            ├─ bun typecheck     (tsc --noEmit)
            ├─ bun format:check  (oxfmt --check)
            ├─ bun knip          (unused exports/deps)
            ├─ bun test          (bun:test, unit only)
            └─ bun security:ci   (semgrep → SARIF)
  └─ jobs.e2e (separate job; Docker required)
```

### Tool module test pattern (established)

All existing tool tests follow a consistent pattern using `tests/tools/mock-provider.ts`:

```
tests/tools/<group>-tools.test.ts
  └─ describe('<Group> Tools')
       └─ describe('make<ToolName>Tool')
            ├─ test('returns tool with correct structure')
            ├─ test('executes <action> successfully')
            ├─ test('propagates API errors')
            └─ test('validates required parameters')
```

`makeDeleteTaskTool` and `checkConfidence` must follow this same pattern so test output clearly identifies their module by name.

### No new libraries required

All required functionality is already available via:

- `bun:test` (already used) — test runner with `describe`, `test`, `mock`, `beforeEach`
- `tests/tools/mock-provider.ts` (already used) — shared provider mock factory
- `tests/test-helpers.ts` (already used) — `getToolExecutor`, `schemaValidates`

---

## Detailed Task Breakdown

### Story 2: Extend CI push trigger to all branches

**Objective**: Remove the `branches: [master]` restriction from the `push` trigger in `.github/workflows/ci.yml` so every push to every branch (feature branches, hotfixes, etc.) triggers the full quality check. The existing `pull_request` trigger remains unchanged.

#### Task 2.1 — Widen the CI push trigger

- **File**: `.github/workflows/ci.yml`
- **Change**: Replace:
  ```yaml
  on:
    push:
      branches: [master]
    pull_request:
      branches: [master]
  ```
  with:
  ```yaml
  on:
    push:
    pull_request:
      branches: [master]
  ```
  Removing `branches: [master]` from the `push` key makes it fire on all refs. The `pull_request` trigger remains scoped to PRs targeting `master` (no change).
- **Estimate**: 0.25h | **Priority**: High
- **Acceptance Criteria**:
  - A push to a feature branch (e.g. `feat/my-feature`) triggers the `check` job
  - A push to `master` still triggers the `check` job
  - PRs to `master` still trigger the `check` job
  - The E2E job trigger is unaffected (it has no `push` trigger)
- **Dependencies**: None

---

### Story 3 / 4: Unit tests for `makeDeleteTaskTool`

**Objective**: Add unit tests for `makeDeleteTaskTool` to `tests/tools/task-tools.test.ts`, covering the tool's structure, successful execution at high confidence, the confirmation gate blocking at low confidence, and error propagation. These follow the same pattern as `makeArchiveTaskTool` tests already in that file.

#### Task 3.1 — Add `makeDeleteTaskTool` describe block

- **File**: `tests/tools/task-tools.test.ts`
- **Imports to add**: `makeDeleteTaskTool` from `../../src/tools/delete-task.js`
- **Test cases**:
  1. `returns tool with correct structure` — `makeDeleteTaskTool(provider).description` contains `'Delete'`
  2. `deletes task when confidence is high` — execute with `{ taskId: 'task-1', confidence: 0.9 }`, assert `provider.deleteTask` called with `'task-1'`
  3. `returns confirmation_required when confidence is low` — execute with `{ taskId: 'task-1', confidence: 0.5 }`, assert result has `status: 'confirmation_required'`
  4. `returns confirmation_required without confidence field` — execute with `{ taskId: 'task-1', confidence: 0 }`, assert same shape
  5. `propagates provider errors` — mock `deleteTask` to reject; assert the promise rejects rather than swallowing the error
  6. `validates taskId is required` — `schemaValidates(tool, {})` returns `false`; `schemaValidates(tool, { taskId: 'x', confidence: 0.9 })` returns `true`
- **Estimate**: 1h ±0.5h | **Priority**: High
- **Acceptance Criteria**:
  - All 6 tests pass with `bun test tests/tools/task-tools.test.ts`
  - Test output shows `makeDeleteTaskTool` as a named `describe` block, clearly identifying the module
  - No `@ts-ignore`, no `eslint-disable`
- **Dependencies**: None (mock provider already supports `deleteTask`)

---

### Story 3 / 4: Unit tests for `confirmation-gate`

**Objective**: Add a dedicated test file for `src/tools/confirmation-gate.ts` covering `checkConfidence` and `confidenceField`. This module currently has zero test coverage despite being critical to every destructive tool path.

#### Task 4.1 — Create `tests/tools/confirmation-gate.test.ts`

- **File**: `tests/tools/confirmation-gate.test.ts` (new file)
- **Imports**: `checkConfidence`, `confidenceField` from `../../src/tools/confirmation-gate.js`; `describe`, `test`, `expect` from `bun:test`; `z` from `zod`
- **Test cases**:
  1. `returns null when confidence equals threshold (0.85)` — `checkConfidence(0.85, 'Delete task')` returns `null`
  2. `returns null when confidence is above threshold` — `checkConfidence(1.0, 'Delete task')` returns `null`; `checkConfidence(0.9, 'Delete task')` returns `null`
  3. `returns confirmation_required when confidence is below threshold` — `checkConfidence(0.84, 'Delete task')` has `status: 'confirmation_required'`
  4. `confirmation message includes the action description` — `checkConfidence(0.5, 'Archive "Auth" project').message` contains `'Archive "Auth" project'`
  5. `returns confirmation_required when confidence is zero` — `checkConfidence(0, 'x').status` equals `'confirmation_required'`
  6. `confidenceField schema accepts values 0 to 1` — `z.safeParse(confidenceField, 0.9).success` is `true`; `z.safeParse(confidenceField, 1.5).success` is `false`; `z.safeParse(confidenceField, -0.1).success` is `false`
- **Estimate**: 0.75h ±0.25h | **Priority**: High
- **Acceptance Criteria**:
  - All 6 tests pass with `bun test tests/tools/confirmation-gate.test.ts`
  - `bun test tests/tools/` passes with no failures
  - Test output shows `Confirmation Gate` or `checkConfidence` as a named `describe` block
  - No `@ts-ignore`, no `eslint-disable`
- **Dependencies**: None

---

## Risk Assessment Matrix

| Risk                                                                                            | Probability | Impact | Mitigation                                                                                                                                       |
| ----------------------------------------------------------------------------------------------- | ----------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Widening `push` trigger causes excessive CI runs on every branch push                           | Medium      | Low    | Acceptable trade-off; this is the intended behaviour per US2. GitHub Actions billing is per-minute and these jobs run in ~30s.                   |
| `deleteTask` mock calls a `provider` method that `createMockProvider` does not expose           | Low         | Medium | Inspect `tests/tools/mock-provider.ts` before writing tests; add `deleteTask` to the mock if absent                                              |
| `confidenceField` is a Zod schema object and `z.safeParse` API may differ between Zod v3 and v4 | Low         | Low    | Project uses `zod@^4`. Verify `z.safeParse(schema, value)` vs `schema.safeParse(value)` syntax against the already-passing tests in the codebase |
| US1 and US4 marked as already complete — if audit is wrong, additional work needed              | Very Low    | Medium | Re-run `bun check` and `bun test` before closing this plan to confirm state                                                                      |

---

## Resource Requirements

- **Total estimated development time**: ~2.5h (Tasks 2.1 + 3.1 + 4.1)
- **Skills required**: GitHub Actions YAML, `bun:test` patterns
- **External dependencies**: None — no new packages, no new CI services
- **Testing requirements**: All new tests must run within `bun test tests/tools/` and be included in the main `bun test` command

---

## Execution Order

Tasks are independent and can be executed in any order. Suggested sequence:

1. **Task 2.1** — CI trigger fix (fastest, highest impact, zero test risk)
2. **Task 4.1** — Confirmation gate tests (self-contained new file, no existing file conflict)
3. **Task 3.1** — Delete task tests (extends existing file, verify imports don't collide)

---

## Completion Checklist

- [ ] Task 2.1: `push: branches: [master]` removed from `ci.yml`; verified in GitHub Actions that a feature branch push triggers the job
- [ ] Task 3.1: `makeDeleteTaskTool` describe block added; all 6 tests pass; describe name visible in `bun test` output
- [ ] Task 4.1: `tests/tools/confirmation-gate.test.ts` created; all 6 tests pass
- [ ] `bun check` exits 0 after all changes (lint + typecheck + format + knip + test + security)
- [ ] Total test count ≥ 649 (637 existing + ~12 new) — well above the 95-test baseline
- [ ] No `@ts-ignore`, `@ts-nocheck`, `eslint-disable`, or `oxlint-disable` in any modified file
