# Phase 6: Test Infrastructure & Isolation — Detailed Test Plan

**Date:** 2026-03-22
**Status:** Draft
**Priority:** Low
**Prerequisites:** Phases 1–4 completed
**Goal:** Prevent future regressions in test quality by fixing test isolation risks, standardising mock patterns, and expanding mutation testing scope

---

## Epic Overview

- **Business Value**: Eliminate test-ordering dependencies and flaky tests that erode confidence in CI; expand mutation testing to catch regressions across more source files
- **Success Metrics**: Zero test-ordering failures (verified via randomised runs), StrykerJS break threshold raised to ≥50%, `mutate` scope covers 10+ source file patterns
- **Priority**: Low (infrastructure improvement — no user-facing change, but guards against silent regressions)

---

## Technical Architecture

### Components Affected

| Component                      | File(s)                                                      | Responsibility                                     |
| ------------------------------ | ------------------------------------------------------------ | -------------------------------------------------- |
| Conversation test isolation    | `tests/conversation.test.ts`                                 | Reset `generateTextImpl` between tests             |
| Group context isolation test   | `tests/group-context-isolation.test.ts`                      | Replace manual DDL with migration-based DB setup   |
| Kaneo task-status test mocking | `tests/providers/kaneo/task-status.test.ts`                  | Make `listColumns` mock configurable per-test      |
| Test helper deduplication      | `tests/test-helpers.ts`                                      | Remove duplicate `createMockActivityForList`       |
| Mock pattern documentation     | `docs/TESTING_METHODOLOGY.md` or new `docs/MOCK_PATTERNS.md` | Document preferred patterns                        |
| StrykerJS configuration        | `stryker.config.json`                                        | Expand `mutate` array and raise `thresholds.break` |

### Data Flow: Test Isolation Fix

```
beforeEach() ──▶ reset module-scoped mutable state ──▶ test runs in clean context
                 (generateTextImpl, mock config, DB)
                      │
                      ▼
afterEach()  ──▶ restore spies, fetch mocks, DB teardown
```

---

## Detailed Task Breakdown

### Task 6.1 — Fix Test Isolation Risks

#### Task 6.1.1 — `tests/conversation.test.ts`: Reset `generateTextImpl` in `beforeEach`

**Current problem**: `generateTextImpl` is a module-scoped `let` variable (line 12) that defaults to a success stub. The `runTrimInBackground` describe block's `beforeEach` (line 163) resets `mockSummaries`, `mockHistories`, `mockConfigs` — but never resets `generateTextImpl`. Two tests reassign it:

- Line 231: reassigns to a multi-call counting impl (for "preserves new messages during async trim")
- Line 296: reassigns to `Promise.reject(new Error('LLM API error'))` (for failure test)

If bun runs tests in a different order, or if a test fails mid-execution before the end-of-test `mockRestore()` calls, subsequent tests inherit the mutated `generateTextImpl` and either fail or produce false positives.

**Required changes**:

- [ ] **6.1.1a** Define a named constant for the default `generateTextImpl`:

  ```typescript
  const defaultGenerateTextImpl = (): Promise<GenerateTextResult> =>
    Promise.resolve({ output: { keep_indices: [0, 1], summary: 'Updated summary text' } })
  let generateTextImpl = defaultGenerateTextImpl
  ```

  Acceptance: `defaultGenerateTextImpl` is a `const`, `generateTextImpl` initialised from it.

- [ ] **6.1.1b** Add `generateTextImpl = defaultGenerateTextImpl` to the `runTrimInBackground` describe block's `beforeEach`:

  ```typescript
  beforeEach(() => {
    generateTextImpl = defaultGenerateTextImpl // ← ADD THIS
    mockSummaries.clear()
    mockHistories.clear()
    mockConfigs.clear()
  })
  ```

  Acceptance: every test in `runTrimInBackground` starts with the default success stub. The two tests that need custom behaviour still override it inside their own test body — that's fine since `beforeEach` runs before each test.

- [ ] **6.1.1c** Verify fix: temporarily reorder the tests (move the `Promise.reject` error test before the success test) and run `bun test tests/conversation.test.ts`. Both must pass.

| Risk                                                                       | Probability | Impact | Mitigation                                                                                                      |
| -------------------------------------------------------------------------- | ----------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| Other describe blocks in same file also rely on `generateTextImpl` default | Low         | Low    | Only `runTrimInBackground` uses it; `shouldTriggerTrim` and `buildMessagesWithMemory` don't call `generateText` |

---

#### Task 6.1.2 — `tests/group-context-isolation.test.ts`: Replace manual DDL with `setupTestDb()` + migrations

**Current problem**: The file creates its own in-memory SQLite database and manually runs `CREATE TABLE` SQL (lines 31-48) that duplicates the schema from `src/db/schema.ts`. This is a schema drift risk: if a migration adds a column (e.g., a new field on `users` or `group_members`), the manual DDL here won't have it, causing silent mismatches between test and production schemas.

The same problem exists in `tests/scheduler.test.ts` (lines 93-116), but the scheduler's manual DDL covers tables (`recurring_tasks`, `recurring_task_occurrences`) that are specific to its test domain and its isolation is already good. The group-context-isolation test only needs `users` and `group_members` — both of which `setupTestDb()` creates properly via migrations.

**Required changes**:

- [ ] **6.1.2a** Import `setupTestDb` and `mockDrizzle` from `tests/utils/test-helpers.js`
- [ ] **6.1.2b** Replace the manual DDL + `drizzle()` setup with:

  ```typescript
  import { mockLogger, setupTestDb, mockDrizzle } from './utils/test-helpers.js'

  mockLogger()
  mockDrizzle()

  import { checkAuthorizationExtended } from '../src/bot.js'
  import { addGroupMember } from '../src/groups.js'
  import { addUser } from '../src/users.js'

  describe('group context isolation', () => {
    beforeEach(async () => {
      await setupTestDb()
    })
    // ... tests unchanged ...
  })
  ```

- [ ] **6.1.2c** Remove the manual `Database`, `testSqlite`, `testDb`, `drizzle` imports and the `CREATE TABLE` statements
- [ ] **6.1.2d** Remove the direct `mock.module('../src/db/drizzle.js', ...)` call that's currently at file scope — `mockDrizzle()` handles this
- [ ] **6.1.2e** Verify: `bun test tests/group-context-isolation.test.ts` — all 4 tests pass

**Acceptance criteria**:

- Zero `CREATE TABLE` statements in the file
- File uses `setupTestDb()` in `beforeEach`
- All 4 existing tests pass with identical assertions

| Risk                                                                                                     | Probability | Impact | Mitigation                                                                                                             |
| -------------------------------------------------------------------------------------------------------- | ----------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| `setupTestDb()` creates all tables, not just `users` and `group_members` — could affect test assumptions | Low         | Low    | Tests only read/write `users` and `group_members`; extra tables are empty and harmless                                 |
| `mockLogger()` import changes mock ordering                                                              | Low         | Medium | Place `mockLogger()` before `mockDrizzle()`, both before any src/ imports — matches pattern used in `bot-auth.test.ts` |

---

#### Task 6.1.3 — `tests/providers/kaneo/task-status.test.ts`: Make `listColumns` mock configurable per-test

**Current problem**: The `listColumns` mock is defined at file scope (line 14-22) with a static array of 3 columns (`To Do`, `In Progress`, `Done`). Every test in the file shares this same column set. This means:

1. You can't test `validateStatus` against a project with different/custom columns
2. You can't test the empty-columns edge case
3. You can't test when `listColumns` itself throws an error

The mock uses `mock.module()` which is file-scoped and cannot be changed per-test after import resolution.

**Required changes**:

- [ ] **6.1.3a** Replace the static `listColumns` mock with a delegating pattern:

  ```typescript
  let listColumnsImpl: (
    config: KaneoConfig,
    projectId: string,
  ) => Promise<Array<{ id: string; name: string; order: number }>>

  const defaultColumns = [
    { id: 'col-1', name: 'To Do', order: 0 },
    { id: 'col-2', name: 'In Progress', order: 1 },
    { id: 'col-3', name: 'Done', order: 2 },
  ]

  void mock.module('../../../src/providers/kaneo/list-columns.js', () => ({
    listColumns: (...args: [KaneoConfig, string]) => listColumnsImpl(...args),
  }))
  ```

- [ ] **6.1.3b** Add `listColumnsImpl = () => Promise.resolve(defaultColumns)` to `beforeEach` (or add a `beforeEach` if not present — currently only `afterEach` exists):

  ```typescript
  beforeEach(() => {
    listColumnsImpl = () => Promise.resolve(defaultColumns)
  })
  ```

- [ ] **6.1.3c** Verify all existing tests pass without changes (they rely on the 3 default columns, which remain the default)

- [ ] **6.1.3d** (Optional, for future Phase 4 work) Add a test that uses a custom column set:
  ```typescript
  test('validates against custom project columns', async () => {
    listColumnsImpl = () =>
      Promise.resolve([
        { id: 'col-x', name: 'Backlog', order: 0 },
        { id: 'col-y', name: 'Shipped', order: 1 },
      ])
    const result = await validateStatus(mockConfig, 'proj-1', 'Backlog')
    expect(result).toBe('backlog')
  })
  ```

**Acceptance criteria**:

- `listColumnsImpl` is a `let` variable reset in `beforeEach`
- All existing tests pass unchanged
- It's now possible to override columns per-test

| Risk                                                                    | Probability | Impact | Mitigation                                                                                                                       |
| ----------------------------------------------------------------------- | ----------- | ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Bun's `mock.module` caching means the delegating pattern might not work | Low         | High   | This pattern is already used successfully in `tests/scheduler.test.ts` (`createTaskImpl`, `addTaskLabelImpl`) — verified working |
| Type mismatch between mock and real `listColumns` signature             | Low         | Low    | Import `KaneoConfig` type and type the impl accordingly                                                                          |

---

### Task 6.2 — Standardise Mock Patterns

#### Task 6.2.1 — Audit and document fetch mock patterns

**Current state**: Two divergent patterns exist:

| Pattern                         | Used by                                                                                                                                         | Mechanism                                                                                                                | Restoration                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `setMockFetch` / `restoreFetch` | All Kaneo tests (`tests/test-helpers.ts` lines 171-186)                                                                                         | Replaces `globalThis.fetch` with mock handler + restores from saved `originalFetch`                                      | `afterEach(() => restoreFetch())`                       |
| Local `installFetchMock`        | YouTrack tests (`labels.test.ts`, `operations/tasks.test.ts`, `operations/projects.test.ts`, `operations/comments.test.ts`, `provider.test.ts`) | Defines a local function that replaces `globalThis.fetch` with a mock — each file re-implements the same 4-line function | `afterEach(() => { globalThis.fetch = originalFetch })` |

**Required changes**:

- [ ] **6.2.1a** Document the preferred pattern in `docs/TESTING_METHODOLOGY.md` (or as a new section if the file exists). Recommended: `setMockFetch` / `restoreFetch` from `tests/test-helpers.ts` — it's centralised, already handles `preconnect`, and avoids code duplication.

  The documentation should include:
  - When to use `setMockFetch` (HTTP-level tests for providers)
  - When to use `mock.module` (replacing entire modules like `ai`, `drizzle`)
  - When to use `spyOn` (partial module mocking where you need original implementation)
  - Mandatory restoration patterns: `afterEach(() => restoreFetch())`, `spy.mockRestore()` in `afterEach` or at end of test

- [ ] **6.2.1b** (Not mandatory — just document) Note that unifying YouTrack's `installFetchMock` into `setMockFetch` is a nice-to-have but low priority since both work correctly. The key insight is both save/restore `originalFetch`, so isolation is already fine.

**Acceptance criteria**:

- Documented which mock pattern to use for new tests
- No existing test behaviour changed (this is documentation only)

---

#### Task 6.2.2 — Ensure all `spyOn` / `mock.module` restore in `afterEach`

**Current state audit findings**:

| File                                        | Pattern                                                         | Current Restoration                                           | Issue                                                                                    |
| ------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `tests/conversation.test.ts`                | `spyOn(cacheModule, ...)`                                       | Each test manually calls `.mockRestore()` at end of test body | If a test throws before reaching `mockRestore()`, the spy leaks. Should use `afterEach`. |
| `tests/scheduler.test.ts`                   | `mock.module` at file scope + `afterAll(() => mock.restore())`  | `afterAll` + `afterEach` for `stopScheduler()`                | Good — `mock.restore()` in `afterAll` prevents cross-file leakage                        |
| `tests/tools/*.test.ts` (7 files)           | `mock.module` + `mock.restore()` in `afterAll`                  | `afterAll(() => mock.restore())`                              | Good                                                                                     |
| `tests/providers/kaneo/*.test.ts` (9 files) | `mock.restore()` in `afterAll`, `restoreFetch()` in `afterEach` | Both `afterAll` and `afterEach`                               | Good                                                                                     |

**Key finding**: `tests/conversation.test.ts` is the only file where spy restoration happens inline in each test body rather than in `afterEach`. This is fragile.

**Required changes**:

- [ ] **6.2.2a** Refactor `conversation.test.ts` `buildMessagesWithMemory` describe block: move spy creation to `beforeEach` and restoration to `afterEach`:

  ```typescript
  describe('buildMessagesWithMemory', () => {
    const mockSummaries = new Map<string, string>()
    const mockFacts = new Map<string, Array<...>>()
    let getCachedSummarySpy: ReturnType<typeof spyOn>
    let getCachedFactsSpy: ReturnType<typeof spyOn>

    beforeEach(() => {
      mockSummaries.clear()
      mockFacts.clear()
      getCachedSummarySpy = spyOn(cacheModule, 'getCachedSummary').mockReturnValue(null)
      getCachedFactsSpy = spyOn(cacheModule, 'getCachedFacts').mockReturnValue([])
    })

    afterEach(() => {
      getCachedSummarySpy.mockRestore()
      getCachedFactsSpy.mockRestore()
    })

    // Tests no longer need to create/restore spies individually
  })
  ```

  Note: tests that need custom mock return values can call `.mockReturnValue(...)` in the test body — it overrides the `beforeEach` default.

- [ ] **6.2.2b** Refactor `conversation.test.ts` `runTrimInBackground` describe block similarly: declare spy variables at describe scope, create in `beforeEach`, restore in `afterEach`. This also fixes the issue from 6.1.1 since `generateTextImpl` reset would be in the same `beforeEach`.

- [ ] **6.2.2c** Verify: `bun test tests/conversation.test.ts` — all tests pass.

**Acceptance criteria**:

- Zero `mockRestore()` calls inside test bodies in `conversation.test.ts`
- All spy restoration happens in `afterEach`
- All existing tests pass

| Risk                                                                                                        | Probability | Impact | Mitigation                                                                                                      |
| ----------------------------------------------------------------------------------------------------------- | ----------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| Moving spy creation to `beforeEach` changes mock return values for tests that currently set specific values | Medium      | Medium | Tests that need custom values override in their test body — `mockReturnValue` on an already-created spy is fine |
| The `buildMessagesWithMemory` tests set different return values per test for summary/facts                  | Medium      | Low    | Default to `null`/`[]` in `beforeEach`, override in test body via `getCachedSummarySpy.mockReturnValue(...)`    |

---

#### Task 6.2.3 — Remove duplicate `createMockActivity` / `createMockActivityForList` in `test-helpers.ts`

**Current state**: `tests/test-helpers.ts` exports two functions:

1. `createMockActivity` (lines 127-141): returns an `ActivityItem` with hardcoded defaults
2. `createMockActivityForList` (lines 144-158): returns an identical `ActivityItem` with identical defaults, cast with `as ActivityItem`

These are **byte-for-byte identical** in their output — only the function name and the unnecessary `as ActivityItem` cast differ.

**Required changes**:

- [ ] **6.2.3a** Find all usages of `createMockActivityForList`:

  ```
  grep -rn 'createMockActivityForList' tests/
  ```

  Check which test files import and use it.

- [ ] **6.2.3b** Replace all `createMockActivityForList` imports with `createMockActivity`
- [ ] **6.2.3c** Remove the `createMockActivityForList` export from `tests/test-helpers.ts`
- [ ] **6.2.3d** Run `bun test` — all tests pass
- [ ] **6.2.3e** Run `bunx knip` to verify no dead code remains

**Acceptance criteria**:

- `createMockActivityForList` no longer exists in the codebase
- All tests that previously used it now use `createMockActivity`
- No type errors, all tests pass

| Risk                                                              | Probability | Impact | Mitigation                                               |
| ----------------------------------------------------------------- | ----------- | ------ | -------------------------------------------------------- |
| Some test relies on the `as ActivityItem` cast for type narrowing | Very Low    | Low    | The return types are identical — both are `ActivityItem` |

---

### Task 6.3 — Expand Mutation Testing Scope

#### Current StrykerJS Configuration

**File**: `stryker.config.json`

Current `mutate` array:

```json
[
  "src/providers/**/*.ts",
  "!src/providers/**/index.ts",
  "!src/providers/**/constants.ts",
  "!src/providers/types.ts",
  "src/tools/**/*.ts",
  "!src/tools/index.ts",
  "src/errors.ts",
  "src/config.ts",
  "src/memory.ts",
  "src/users.ts"
]
```

Current thresholds:

```json
{
  "high": 80,
  "low": 60,
  "break": 30
}
```

Current mutation score: **35.41%** overall (just above the 30% break threshold).

---

#### Task 6.3.1 — Add `src/cron.ts` to `mutate` array

**Rationale**: After Phase 4 (Task 4.4.5–4.4.6), `cron.ts` will have edge case tests for impossible dates and DST transitions, adding to the existing `cron.test.ts` coverage (currently scored 7.5/10 in the audit). The `parseCron` and `allOccurrencesBetween` functions are pure and highly testable.

**Required change**: Add `"src/cron.ts"` to the `mutate` array in `stryker.config.json`.

**Pre-check**: Run `stryker run --mutate src/cron.ts` standalone first to see the current mutation score for this file. If it's already ≥50%, safe to add.

---

#### Task 6.3.2 — Add `src/recurring.ts` to `mutate` array

**Rationale**: `recurring.test.ts` already scores 8.5/10 in the audit. The file contains CRUD operations for recurring tasks, all tested. Current test file has good coverage of create, update, delete, list, get, enable/disable operations.

**Required change**: Add `"src/recurring.ts"` to the `mutate` array.

**Pre-check**: Run `stryker run --mutate src/recurring.ts` standalone. Expect ≥40% mutation score based on test coverage audit.

---

#### Task 6.3.3 — Add `src/history.ts` to `mutate` array

**Rationale**: `history.test.ts` scores 8.5/10 in the audit. The module handles conversation history CRUD (load, save, append, clear). After Phase 2 (Task 2.4.2 — `appendHistory` tests), coverage will be complete.

**Required change**: Add `"src/history.ts"` to the `mutate` array.

**Pre-check**: Run `stryker run --mutate src/history.ts` standalone. Verify ≥40%.

---

#### Task 6.3.4 — Add `src/conversation.ts` to `mutate` array

**Rationale**: After Phase 4 (Task 4.4.1–4.4.2) adds boundary and concurrency tests, plus Phase 6 Task 6.1.1 fixes isolation, `conversation.ts` will have solid coverage. The `shouldTriggerTrim`, `buildMessagesWithMemory`, and `runTrimInBackground` functions are all tested.

**Required change**: Add `"src/conversation.ts"` to the `mutate` array.

**Pre-check**: Run `stryker run --mutate src/conversation.ts` standalone after Phase 4 + 6.1.1 changes. Verify ≥40%.

---

#### Task 6.3.5 — Raise StrykerJS `thresholds.break` from 30 → 50

**Rationale**: After Phases 1–5 fix broken tests, fill coverage gaps, and harden assertions, the overall mutation score should increase. The current score is 35.41%. With the improvements from Phases 1–5, and the existing `src/errors.ts` at 95%, `src/memory.ts` at 61%, the weighted average should rise above 50%.

**Required changes**:

- [ ] **6.3.5a** Run the full mutation suite after all other Phase 6 changes: `bun run test:mutate`
- [ ] **6.3.5b** If overall score is ≥55%, change `thresholds.break` from 30 to 50:
  ```json
  "thresholds": {
    "high": 80,
    "low": 60,
    "break": 50
  }
  ```
- [ ] **6.3.5c** If overall score is between 45-55%, set `break` to `score - 5` (conservative buffer)
- [ ] **6.3.5d** If overall score is still <45%, leave `break` at 30 and document which source files are dragging the score down — those become targets for Phase N+1

**Acceptance criteria**:

- `thresholds.break` is raised to the maximum safe value (at least 5 points below current score)
- `bun run test:mutate` passes with the new threshold

| Risk                                                                | Probability | Impact | Mitigation                                                                         |
| ------------------------------------------------------------------- | ----------- | ------ | ---------------------------------------------------------------------------------- |
| Adding new source files to `mutate` lowers overall score (dilution) | Medium      | Medium | Pre-check each file independently; only add files with ≥40% standalone score       |
| New threshold causes CI failures on unrelated PRs                   | Low         | High   | Use 5-point buffer below actual score; announce threshold change in PR description |

---

## Final `stryker.config.json` `mutate` Array (Target State)

```json
"mutate": [
  "src/providers/**/*.ts",
  "!src/providers/**/index.ts",
  "!src/providers/**/constants.ts",
  "!src/providers/types.ts",
  "src/tools/**/*.ts",
  "!src/tools/index.ts",
  "src/errors.ts",
  "src/config.ts",
  "src/memory.ts",
  "src/users.ts",
  "src/cron.ts",
  "src/recurring.ts",
  "src/history.ts",
  "src/conversation.ts"
]
```

This expands from **6 source patterns** (4 files + 2 globs) to **10 source patterns** (8 files + 2 globs).

---

## Risk Assessment Matrix

| Risk                                                                  | Probability | Impact | Mitigation                                                                 | Owner |
| --------------------------------------------------------------------- | ----------- | ------ | -------------------------------------------------------------------------- | ----- |
| `generateTextImpl` reset breaks tests that depend on cross-test state | Low         | Medium | Verify by running tests in isolation and in full suite                     | Dev   |
| `setupTestDb()` migration set diverges from manual DDL in edge cases  | Very Low    | Low    | Migrations are the source of truth — this is the whole point of the change | Dev   |
| Raising mutation threshold too aggressively blocks PRs                | Medium      | High   | Use 5-point buffer; announce in PR; can revert threshold quickly           | Dev   |
| Mock pattern documentation becomes stale                              | Medium      | Low    | Keep concise; link from `CONTRIBUTING.md`                                  | Dev   |
| `createMockActivityForList` removal breaks a test that imports it     | Very Low    | Low    | Grep first; the function is identical to `createMockActivity`              | Dev   |
| Bun test runner order is non-deterministic by default                 | Medium      | Medium | After fixes, verify by running `bun test --rerun-each 3` or similar        | Dev   |

---

## Implementation Order

```
6.2.3 (remove duplicate helper)         — quick win, no risk
  │
  ├── 6.1.1 (conversation.test.ts reset) — fixes real isolation bug
  │     │
  │     └── 6.2.2 (spy restoration refactor) — builds on 6.1.1 changes to same file
  │
  ├── 6.1.2 (group-context DDL → migrations) — independent
  │
  ├── 6.1.3 (task-status configurable mock)  — independent
  │
  └── 6.2.1 (document mock patterns)         — independent, do after 6.2.2
        │
        └── 6.3.1–6.3.4 (expand mutate scope) — after all isolation fixes
              │
              └── 6.3.5 (raise threshold)      — must be last
```

**Recommended PR structure**:

1. **PR 1**: Tasks 6.2.3 + 6.1.1 + 6.2.2 (conversation test isolation + helper cleanup)
2. **PR 2**: Tasks 6.1.2 + 6.1.3 (DB setup + mock configurability)
3. **PR 3**: Tasks 6.2.1 (documentation)
4. **PR 4**: Tasks 6.3.1–6.3.5 (StrykerJS scope + threshold)

---

## Phase 6 Definition of Done

- [ ] Zero `generateTextImpl` leaks across tests — verified by reordering tests
- [ ] Zero manual `CREATE TABLE` in `group-context-isolation.test.ts`
- [ ] `listColumnsImpl` in `task-status.test.ts` is resettable per-test via `beforeEach`
- [ ] Zero `mockRestore()` calls inside test bodies (all in `afterEach`)
- [ ] `createMockActivityForList` removed — only `createMockActivity` exists
- [ ] Mock pattern preferences documented
- [ ] StrykerJS `mutate` array includes `src/cron.ts`, `src/recurring.ts`, `src/history.ts`, `src/conversation.ts`
- [ ] StrykerJS `thresholds.break` raised to ≥50% (or documented reason if not possible)
- [ ] `bun test` green
- [ ] `bun run test:mutate` green with new threshold

---

## Verification Commands

```bash
# Run full test suite
bun test

# Run specific files affected by isolation fixes
bun test tests/conversation.test.ts
bun test tests/group-context-isolation.test.ts
bun test tests/providers/kaneo/task-status.test.ts

# Verify no dead exports after helper cleanup
bunx knip

# Pre-check mutation scores for new files (run individually)
npx stryker run --mutate src/cron.ts
npx stryker run --mutate src/recurring.ts
npx stryker run --mutate src/history.ts
npx stryker run --mutate src/conversation.ts

# Full mutation run with new config
bun run test:mutate

# Check for forbidden lint suppressions
grep -rn 'eslint-disable\|ts-ignore\|ts-nocheck\|oxlint-disable' tests/ src/
```
