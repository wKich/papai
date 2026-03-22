# Feature: Increase Mutation Score from 26% to ≥ 30%

**Date:** 2026-03-21  
**Status:** Draft  
**Target:** ≥ 30% mutation score (currently 26.2%)

---

## Epic Overview

- **Business Value:** Higher mutation scores catch logic regressions that line-coverage metrics miss. The
  test suite has 757 passing tests but only 26.2% of injected mutants are killed — meaning 2,057 business-logic
  mutations currently go undetected.
- **Success Metrics:** Stryker reports `≥ 30%` on `bun test:mutate`; `bun check` remains green.
- **Timeline:** 3 phases, estimated 2–3 days of focused work.
- **Priority:** High — mutation score is already above the `break: 25` threshold; increasing headroom reduces
  future regression risk.

---

## Current Baseline (2026-03-21)

```
Killed:   729   (detected)
Survived: 2057  (undetected)
Total:    2786  testable mutants
Score:    26.2%
```

**To reach 30%:** 836 detected needed → **kill 107 more mutants**.

---

## Technical Architecture

### What Causes the Gap

All 2,057 survived mutants have NoCoverage = 0 — every mutant is _executed_ by the suite but not
_asserted on_. The dominant mutation types across low-scoring files are:

| Mutation type           | What it means for tests                                   |
| ----------------------- | --------------------------------------------------------- |
| `StringLiteral`         | Return-value fields are not asserted by name/value        |
| `ObjectLiteral`         | Shape of returned objects not verified                    |
| `ConditionalExpression` | Branch logic not tested with inputs that hit both paths   |
| `BlockStatement`        | Error/not-found branches never reached in tests           |
| `EqualityOperator`      | Boundary comparisons (`< 0.85`, `=== null`) not exercised |

### Key Finding: Recurring-Tool Files Are Completely Untested

Six `tools/` files (delete, update, resume, pause, skip, list recurring tasks) have **0% mutation
score and 157 total survived mutants**. Killing ~107 of them alone reaches the 30% target. These
files follow the exact same `make*Tool` / `execute()` pattern as `task-tools.test.ts` — the test
infrastructure is already in place.

### File Scoring Summary (Prioritised)

| File                                        | Survived | Score | Strategy                             |
| ------------------------------------------- | -------- | ----- | ------------------------------------ |
| `tools/delete-recurring-task.ts`            | 36       | 0%    | Add to `recurring-tools.test.ts`     |
| `tools/update-recurring-task.ts`            | 34       | 0%    | Add to `recurring-tools.test.ts`     |
| `tools/resume-recurring-task.ts`            | 29       | 0%    | Add to `recurring-tools.test.ts`     |
| `tools/pause-recurring-task.ts`             | 20       | 0%    | Add to `recurring-tools.test.ts`     |
| `tools/skip-recurring-task.ts`              | 20       | 0%    | Add to `recurring-tools.test.ts`     |
| `tools/list-recurring-tasks.ts`             | 18       | 0%    | Add to `recurring-tools.test.ts`     |
| **Phase 1 total**                           | **157**  | —     | **Alone covers the 107-mutant gap**  |
| `providers/youtrack/operations/tasks.ts`    | 100      | 10.7% | New `youtrack/operations/` test file |
| `providers/youtrack/operations/projects.ts` | 92       | 0%    | New `youtrack/operations/` test file |
| `providers/youtrack/labels.ts`              | 90       | 0%    | New `youtrack/labels.test.ts`        |
| `providers/kaneo/column-resource.ts`        | 65       | 1.5%  | Extend `column-resource.test.ts`     |
| `providers/kaneo/task-status.ts`            | 49       | 14%   | Extend `task-status.test.ts`         |

### Impact Model

```
Current 729 → kill all 157 Phase 1 mutants → 886/2786 = 31.8%
```

Phase 1 is the critical path. Phases 2–3 provide overshoot buffer and long-term quality improvement.

---

## Detailed Task Breakdown

### Phase 1: Recurring Task Tool Tests (critical path to 30%) — Est. 1 day

Target file: `tests/tools/recurring-tools.test.ts` (extend existing, currently 3 tests covering only
`makeCreateRecurringTaskTool`).

All six tool factories follow a single proven pattern:

1. Mock `../../src/recurring.js` to return a controlled `RecurringTaskRecord` or `null`
2. Mock `../../src/logger.js` (already done via `mockLogger()`)
3. Call `tool.execute(input, context)`
4. Assert the exact shape of the returned object

---

- [ ] **Task 1.1 — `makeDeleteRecurringTaskTool` test suite**
  - Estimate: 2h ±0.5h | Priority: H
  - Acceptance Criteria:
    - `confidence < 0.85` → returns `{ status: 'confirmation_required', message: '...' }`; assert exact
      `status` field value (kills `StringLiteral`/`ObjectLiteral` mutations)
    - `confidence >= 0.85`, `deleteRecurringTask` returns `true` → returns
      `{ id, status: 'deleted', message: '...' }`; assert `status === 'deleted'` and `id` matches input
    - `confidence` exactly at boundary `0.85` → executes (kills `EqualityOperator` mutation on `< 0.85`)
    - `deleteRecurringTask` returns `false` → returns `{ error: 'Recurring task not found' }`; assert `error`
      is the exact string (kills `StringLiteral` mutation)
    - Mock call-count assertions confirm `deleteRecurringTask` is not called when `confidence < 0.85`
      (kills `BlockStatement` mutation)
  - Dependencies: existing `mockLogger()`, `bun:test` mock module infrastructure

- [ ] **Task 1.2 — `makeUpdateRecurringTaskTool` test suite**
  - Estimate: 2h ±0.5h | Priority: H
  - Acceptance Criteria:
    - `updateRecurringTask` returns a record → returned object contains `{ id, title, projectId, enabled, nextRun }`;
      assert each field by name and value (kills `StringLiteral`/`ObjectLiteral` mutations — 22 and 8 respectively)
    - `updateRecurringTask` returns `null` → returns `{ error: 'Recurring task not found' }`
    - Update with `cronExpression` field and without — verify both branches pass input through
    - Assert mock is called with the exact `recurringTaskId` (kills `StringLiteral` mutations in log calls)
  - Dependencies: Task 1.1

- [ ] **Task 1.3 — `makeResumeRecurringTaskTool` test suite**
  - Estimate: 2h ±0.5h | Priority: H
  - Acceptance Criteria:
    - `resumeRecurringTask` returns `null` → `{ error: 'Recurring task not found' }`
    - `resumeRecurringTask` returns `{ record, missedDates: [] }` with `createMissed: false` →
      `{ id, title, enabled, nextRun, schedule, status: 'active', missedTasksCreated: 0 }`;
      assert `status === 'active'` and `missedTasksCreated === 0` (kills `EqualityOperator`,
      `ConditionalExpression`, `ObjectLiteral`, `StringLiteral`)
    - `resumeRecurringTask` returns record with `triggerType: 'cron'` → `schedule` is the cron description string
    - `resumeRecurringTask` returns record with `triggerType: 'on_complete'` → `schedule === 'after completion'`
      (kills `ConditionalExpression` mutation on `triggerType === 'cron'`)
    - `createMissed: true` with non-empty `missedDates` → `missedTasksCreated > 0`; assert exact count
      (kills `EqualityOperator` on `missedDates.length > 0`)
    - Also mock `../../src/scheduler.js` `createMissedTasks` to return a count
  - Dependencies: Task 1.1

- [ ] **Task 1.4 — `makePauseRecurringTaskTool` test suite**
  - Estimate: 1.5h ±0.5h | Priority: H
  - Acceptance Criteria:
    - `pauseRecurringTask` returns a record → `{ id, title, enabled: false, status: 'paused' }`;
      assert `status === 'paused'` and `enabled` is the mock value (kills `ObjectLiteral`, `StringLiteral`)
    - `pauseRecurringTask` returns `null` → `{ error: 'Recurring task not found' }`
    - BlockStatement mutation: assert mock is actually called with the correct `recurringTaskId`
  - Dependencies: Task 1.1

- [ ] **Task 1.5 — `makeSkipRecurringTaskTool` test suite**
  - Estimate: 1.5h ±0.5h | Priority: H
  - Acceptance Criteria:
    - `skipNextOccurrence` returns a record → `{ id, title, nextRun, status: 'skipped — next occurrence updated' }`;
      assert exact `status` string (kills `StringLiteral`)
    - `skipNextOccurrence` returns `null` → `{ error: 'Recurring task not found' }`
    - Verify mock is called once with the given `recurringTaskId`
  - Dependencies: Task 1.1

- [ ] **Task 1.6 — `makeListRecurringTasksTool` test suite**
  - Estimate: 1.5h ±0.5h | Priority: H
  - Acceptance Criteria: - `listRecurringTasks` returns multiple records → returned array has same length; each item has
    `{ id, title, projectId, triggerType, schedule, cronExpression, enabled, nextRun, lastRun,
priority, assignee, labels, catchUp }`; assert each field by key (kills `ObjectLiteral`, `StringLiteral`) - Record with `triggerType: 'cron'` and non-null `cronExpression` → `schedule` is the cron description - Record with `triggerType: 'on_complete'` or null `cronExpression` → `schedule === 'after completion'`
    (kills `ConditionalExpression` and `EqualityOperator`) - Empty list → returns `[]` - `listRecurringTasks` is called with the `userId` passed to `makeListRecurringTasksTool`
  - Dependencies: Task 1.1

- [ ] **Task 1.7 — Verify Phase 1 results**
  - Estimate: 0.5h | Priority: H
  - Acceptance Criteria:
    - Run `bun test tests/tools/recurring-tools.test.ts` → all new tests pass
    - Run `bun test:mutate` (or incremental run scoped to `src/tools/`) → mutation score ≥ 30%
    - `bun check` exits 0 (lint, typecheck, format)
  - Dependencies: Tasks 1.1–1.6

---

### Phase 2: YouTrack Operations Tests (buffer above 30%) — Est. 1 day

These functions follow the same pattern as `tests/providers/youtrack/provider.test.ts` but test the
operation functions directly (mocking `youtrackFetch` and the schema parsers).

---

- [ ] **Task 2.1 — Create `tests/providers/youtrack/operations/tasks.test.ts`**
  - Estimate: 3h ±1h | Priority: M
  - Acceptance Criteria:
    - Mock `youtrackFetch` for each operation (create, get, update, delete, list, search)
    - `createYouTrackTask`: happy path asserts `{ id, title, status }` in returned `Task`; also verifies
      `customFields` built correctly when `priority`/`status` provided (kills `ConditionalExpression`)
    - `getYouTrackTask`: happy path + 404 throws classified error
    - `updateYouTrackTask`: tests `title`, `status`, `priority`, `dueDate`, `assignee`, `projectId` paths;
      each optional field: only sent when provided (kills `ConditionalExpression`, `LogicalOperator`)
    - `deleteYouTrackTask`, `listYouTrackTasks`, `searchYouTrackTasks`: basic happy + error paths
    - Error path tests: every function rethrows as `YouTrackClassifiedError` (kills `BlockStatement`)
  - Dependencies: existing `youtrack` test helpers, `mockYoutrackFetch` pattern from `provider.test.ts`

- [ ] **Task 2.2 — Create `tests/providers/youtrack/operations/projects.test.ts`**
  - Estimate: 2h ±0.5h | Priority: M
  - Acceptance Criteria:
    - `listYouTrackProjects`: happy path returns mapped array; archived projects are filtered out
      (kills `ConditionalExpression` on `p.archived !== true`)
    - `getYouTrackProject`: maps `shortName` to URL correctly; falls back to `id` when `shortName` is null
    - `createYouTrackProject`: verifies `shortName` generation (uppercase, non-alphanum stripped) and
      that `description` is only included when defined
    - `updateYouTrackProject`, `deleteYouTrackProject`: basic happy + 404 paths
  - Dependencies: Task 2.1 (shared mock infrastructure)

- [ ] **Task 2.3 — Create `tests/providers/youtrack/operations/comments.test.ts`**
  - Estimate: 1.5h ±0.5h | Priority: M
  - Acceptance Criteria:
    - `addComment`, `listComments`, `updateComment`, `deleteComment`: happy path asserts returned object
      shape (kills `ObjectLiteral`)
    - Each operation asserts the correct HTTP method and path (kills `StringLiteral`)
    - Error paths throw classified errors
  - Dependencies: Task 2.1

- [ ] **Task 2.4 — Create `tests/providers/youtrack/labels.test.ts`**
  - Estimate: 2h ±0.5h | Priority: M
  - Acceptance Criteria:
    - `listYouTrackLabels`, `createYouTrackLabel`, `updateYouTrackLabel`, `deleteYouTrackLabel`: happy +
      error paths
    - `addYouTrackLabelToTask`, `removeYouTrackLabelFromTask`: assert correct API calls (kills `StringLiteral`,
      `ObjectLiteral`)
    - `color` field: test with and without color (kills `ConditionalExpression`)
    - Label rename/filter logic: verify only non-matching labels are retained on removal
      (kills `ArrowFunction` mutation)
  - Dependencies: Task 2.1

---

### Phase 3: Kaneo Column & Status Gaps (further buffer) — Est. 0.5 day

These files already have test files but are under-exercised on branches.

---

- [ ] **Task 3.1 — Extend `tests/providers/kaneo/column-resource.test.ts`**
  - Estimate: 2h ±0.5h | Priority: L
  - Acceptance Criteria:
    - Current score 1.5% (65 survived); target ≥ 40% after this task
    - Test `list` columns: verify returned items include `{ id, name, isFinal, color }` with exact field names
      (kills `StringLiteral`, `ObjectLiteral`)
    - Test `create` and `update` with optional fields present and absent (kills `ConditionalExpression`)
    - Test `delete` happy path + 404
    - Test `reorder` verifying the body sent to the API
  - Dependencies: existing column-resource test file

- [ ] **Task 3.2 — Extend `tests/providers/kaneo/task-status.test.ts`**
  - Estimate: 1.5h ±0.5h | Priority: L
  - Acceptance Criteria:
    - Current score 14% (49 survived — 14 `Regex` mutations)
    - `validateStatus`: test case-insensitive matching, hyphen-normalisation, exact case match
    - Status name normalisation: input with spaces → hyphen slug (kills Regex mutations)
    - Error payload includes `availableStatuses` list (test the array contents)
    - `BlockStatement` branches: test when `listStatuses` returns empty array → error thrown
  - Dependencies: existing task-status test file

---

## Risk Assessment Matrix

| Risk                                                              | Probability | Impact | Mitigation                                                                                           |
| ----------------------------------------------------------------- | ----------- | ------ | ---------------------------------------------------------------------------------------------------- |
| Mock module caching causes test pollution between suites          | Medium      | High   | Follow existing `beforeEach(() => { mock.restore() })` pattern from `task-tools.test.ts`             |
| `bun:test` mock.module hoisting requires careful import ordering  | Medium      | Medium | Study `recurring-tools.test.ts` pattern; call `mock.module()` before importing the module under test |
| Incremental Stryker cache returns stale results for new tests     | Low         | Medium | Delete `reports/stryker-incremental.json` before final validation run                                |
| New tests increase `bun test` runtime and slow `bun check`        | Low         | Low    | All recurring tools use synchronous `execute()` — no async overhead                                  |
| Phase 2 YouTrack tests duplicate coverage from `provider.test.ts` | Low         | Low    | Test operations directly (not through `YouTrackProvider`) to avoid overlap                           |

---

## Resource Requirements

- **Development Hours:** ~14h ±3h total (Phase 1: 9h, Phase 2: 8.5h, Phase 3: 3.5h)
- **Skills Required:** Bun test patterns, `mock.module()` hoisting, Stryker result interpretation
- **External Dependencies:** None — all mocked at module boundary
- **Testing Requirements:** Each phase self-validates by running `bun test` on the new/changed test file

---

## Mocking Reference

### Recurring task mock skeleton (Phase 1 pattern)

```typescript
import { mock, describe, expect, test, beforeEach } from 'bun:test'
import { mockLogger } from '../utils/test-helpers.js'

mockLogger()

// Must be called BEFORE importing the tool under test
void mock.module('../../src/recurring.js', () => ({
  deleteRecurringTask: (id: string): boolean => {
    // Return controlled value in each test via reassignment
  },
}))

import { makeDeleteRecurringTaskTool } from '../../src/tools/delete-recurring-task.js'

describe('makeDeleteRecurringTaskTool', () => {
  beforeEach(() => {
    mock.restore()
  })

  test('returns confirmation_required when confidence < 0.85', async () => {
    const tool = makeDeleteRecurringTaskTool()
    const result = await tool.execute!({ recurringTaskId: 'rec-1', confidence: 0.5 }, { toolCallId: '1', messages: [] })
    expect(result).toEqual({ status: 'confirmation_required', message: expect.stringContaining('sure') })
  })
})
```

### YouTrack fetch mock skeleton (Phase 2 pattern)

```typescript
// Mock at the module boundary — same pattern used in provider.test.ts
const mockFetch = mock(() =>
  Promise.resolve({
    /* raw YouTrack response */
  }),
)
void mock.module('../../src/providers/youtrack/client.js', () => ({
  youtrackFetch: mockFetch,
}))
```

---

## Validation Checklist

- [ ] `bun test` → 0 failures after each phase
- [ ] `bun check` → lint 0 warnings, typecheck passes, format clean
- [ ] `bun test:mutate` → score ≥ 30% after Phase 1
- [ ] No `ts-ignore`, `eslint-disable`, or `@ts-nocheck` introduced
- [ ] No test file references a mocked return value using `any` — use typed mock records

---

## 📋 DISPLAY INSTRUCTIONS FOR OUTER AGENT

**Outer Agent: You MUST present this development plan using the following format:**

1. **Present the COMPLETE development roadmap** - Do not summarize or abbreviate sections
2. **Preserve ALL task breakdown structures** with checkboxes and formatting intact
3. **Show the full risk assessment matrix** with all columns and rows
4. **Display ALL planning templates exactly as generated** - Do not merge sections
5. **Maintain all markdown formatting** including tables, checklists, and code blocks
6. **Present the complete technical specification** without condensing
7. **Show ALL quality gates and validation checklists** in full detail
8. **Display the complete library research section** with all recommendations and evaluations

**Do NOT create an executive summary or overview - present the complete development plan exactly as generated with all detail intact.**
