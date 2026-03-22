# Phase 07 Review Fixes — Implementation Plan

**Created**: 2026-03-22  
**Scope**: Fix all issues identified in the Phase 07 Proactive Assistance code review  
**Runtime**: Bun  
**Test runner**: `bun:test`  
**Linter**: oxlint (no `eslint-disable`, no `@ts-ignore`)

---

## Epic Overview

- **Business Value**: Correct schema mismatches, eliminate code duplication, implement the missing `checkBlocked` alert (US7), complete missing briefing sections, fix the `get_briefing` tool state side-effect bug, and close test coverage gaps — bringing the Phase 07 implementation into full compliance with its plan.
- **Success Metrics**:
  - The `overdueDaysNotified` column in Drizzle schema uses `integer()` matching the DDL
  - `TERMINAL_STATUS_SLUGS`, `isTerminalStatus`, and `fetchAllTasks` exist in exactly one location
  - `checkBlocked` is implemented and wired into `runAlertCycle`
  - `buildSections` produces all six briefing sections specified in the plan
  - `get_briefing` tool does not mark the briefing as delivered in `user_briefing_state`
  - `suggestActions` does not mutate its input sections
  - `ReminderStatus` type is defined and enforced in the service layer
  - No `ReminderNotFoundError` class — consolidated into the project's existing `AppError` pattern
  - Scheduler test isolation is robust (no cross-test spy leakage)
  - All planned test cases that were missing are added
  - All 62+ existing tests continue to pass; new tests pass
  - `bun run typecheck` and `bunx oxlint` clean
- **Priority**: High — addresses a correctness bug (#9), missing user story (US7), and multiple maintainability issues
- **Timeline**: 2–3 days

---

## Issue Summary & Traceability

Each fix references the review finding number for traceability.

| Fix ID | Review # | Severity | Summary                                                   | Files Affected                                                    |
| ------ | -------- | -------- | --------------------------------------------------------- | ----------------------------------------------------------------- |
| F1     | #1       | Critical | `overdueDaysNotified` schema mismatch (text vs integer)   | `src/db/schema.ts`, `src/proactive/service.ts`                    |
| F2     | #3       | High     | Missing `ReminderStatus` type                             | `src/proactive/types.ts`, `src/proactive/reminders.ts`            |
| F3     | #4       | High     | Duplicated `TERMINAL_STATUS_SLUGS` / `isTerminalStatus`   | `src/proactive/shared.ts` (new), `service.ts`, `briefing.ts`      |
| F4     | #5       | High     | Duplicated `fetchAllTasks` / `fetchAllUserTasks`          | `src/proactive/shared.ts` (new), `service.ts`, `briefing.ts`      |
| F5     | #6       | Medium   | `checkBlocked` not implemented (US7)                      | `src/proactive/service.ts`, `tests/proactive/service.test.ts`     |
| F6     | #8       | Medium   | Missing 3 of 6 briefing sections                          | `src/proactive/briefing.ts`, `tests/proactive/briefing.test.ts`   |
| F7     | #9       | Medium   | `get_briefing` tool incorrectly updates briefing state    | `src/proactive/briefing.ts`, `src/proactive/tools.ts`, tests      |
| F8     | #15      | Low      | `suggestActions` mutates input arrays via `.sort()`       | `src/proactive/briefing.ts`                                       |
| F9     | #16      | Low      | `ReminderNotFoundError` vs project's `AppError` pattern   | `src/proactive/reminders.ts`, `src/proactive/tools.ts`, tests     |
| F10    | #10      | Medium   | Scheduler test isolation (spyOn leakage)                  | `tests/proactive/scheduler.test.ts`                               |
| F11    | #11      | Low      | `_briefingJobs` export → `getBriefingJobCount()` accessor | `src/proactive/scheduler.ts`, `tests/proactive/scheduler.test.ts` |
| F12    | #12      | Low      | No initial `pollAlerts()` on startup                      | `src/proactive/scheduler.ts`                                      |
| F13    | —        | Medium   | Missing test cases per plan                               | `tests/proactive/service.test.ts`, `scheduler.test.ts`            |

**Intentionally deferred** (not addressed in this plan):

- Review #2 (scheduler uses `setInterval` instead of `croner`): The existing Phase 8 `src/scheduler.ts` also uses `setInterval` with the project's custom `parseCron`/`nextCronOccurrence` from `src/cron.ts` — this is the established project pattern. `croner` is not installed. Migrating to croner would require changing both schedulers simultaneously — out of scope for a bug-fix pass. The current approach is correct and consistent.
- Review #7 (`runAlertCycleForAllUsers` signature divergence): The implementation's `buildProviderFn` approach is a deliberate improvement over the plan, as each user needs their own provider instance with their own credentials. No fix needed.
- Review #13 (eager `buildProvider` in catch-up hook): Micro-optimization; `getMissedBriefing` returns `null` early when `briefing_time` is not set, so the provider reference is unused in the common case. Not worth the added complexity.

---

## Detailed Task Breakdown

### Phase 1 — Extract Shared Utilities (F3, F4)

Extract duplicated code into a shared module before modifying consumers.

#### Task 1.1 — Create `src/proactive/shared.ts`

- **File**: `src/proactive/shared.ts` (new)
- **Change**: Extract and export:
  1. `TERMINAL_STATUS_SLUGS` constant
  2. `isTerminalStatus(status: string | undefined): boolean` function
  3. `fetchAllTasks(provider: TaskProvider, logContext?: Record<string, unknown>): Promise<TaskListItem[]>` — unified implementation combining `fetchAllUserTasks` from `service.ts` and `fetchAllTasks` from `briefing.ts`; takes an optional `logContext` for including `userId` / `projectId` in warning logs
- **Estimate**: 0.5h ±0.25h | **Priority**: High
- **Acceptance Criteria**:
  - `isTerminalStatus` and `TERMINAL_STATUS_SLUGS` are the single source of truth
  - `fetchAllTasks` contains the 20-project cap, `Promise.allSettled`, and `searchTasks` fallback
  - `bun typecheck` passes
- **Dependencies**: None

#### Task 1.2 — Update `src/proactive/service.ts` to use shared utilities

- **File**: `src/proactive/service.ts`
- **Change**:
  1. Remove local `TERMINAL_STATUS_SLUGS` and `isTerminalStatus` definitions
  2. Remove local `fetchAllUserTasks` function
  3. Import all three from `./shared.js`
  4. Update `runAlertCycle` to call `fetchAllTasks(provider, { userId })` instead of `fetchAllUserTasks(userId, provider)`
- **Estimate**: 0.25h ±0 | **Priority**: High
- **Acceptance Criteria**: `bun test tests/proactive/service.test.ts` passes unchanged; no duplicate definitions remain
- **Dependencies**: Task 1.1

#### Task 1.3 — Update `src/proactive/briefing.ts` to use shared utilities

- **File**: `src/proactive/briefing.ts`
- **Change**:
  1. Remove local `TERMINAL_STATUS_SLUGS` and `isTerminalStatus` definitions
  2. Remove local `fetchAllTasks` function
  3. Import all three from `./shared.js`
  4. Update `generate()` to call `fetchAllTasks(provider)` (imported from shared)
- **Estimate**: 0.25h ±0 | **Priority**: High
- **Acceptance Criteria**: `bun test tests/proactive/briefing.test.ts` passes unchanged; no duplicate definitions remain
- **Dependencies**: Task 1.1

#### Task 1.4 — Update `src/proactive/index.ts` barrel export

- **File**: `src/proactive/index.ts`
- **Change**: Add `export { TERMINAL_STATUS_SLUGS, isTerminalStatus, fetchAllTasks } from './shared.js'` for consumers that may need these downstream.
- **Estimate**: 0.1h ±0 | **Priority**: Low
- **Dependencies**: Task 1.1

---

### Phase 2 — Schema & Type Fixes (F1, F2)

#### Task 2.1 — Fix `overdueDaysNotified` Drizzle type (F1)

- **File**: `src/db/schema.ts`
- **Change**: Replace `overdueDaysNotified: text('overdue_days_notified').default('0')` with `overdueDaysNotified: integer('overdue_days_notified').default(0)` using `import { integer } from 'drizzle-orm/sqlite-core'` (add to existing import).
- **Estimate**: 0.25h ±0 | **Priority**: Critical
- **Acceptance Criteria**:
  - `typeof alertState.$inferSelect.overdueDaysNotified` is `number | null` (not `string | null`)
  - `bun typecheck` passes
- **Dependencies**: None

#### Task 2.2 — Update `src/proactive/service.ts` to use integer `overdueDaysNotified`

- **File**: `src/proactive/service.ts`
- **Change**: After Task 2.1 changes the Drizzle column type to `integer`, all code that reads/writes `overdueDaysNotified` must deal with `number` instead of `string`:
  1. In `insertNewAlertState`: change `overdueDaysNotified: alertType === 'overdue' ? '1' : '0'` → `overdueDaysNotified: alertType === 'overdue' ? 1 : 0`
  2. In `updateAlertState` status-changed branch: change `updates['overdueDaysNotified'] = '0'` → use typed Drizzle `.set({ overdueDaysNotified: 0 })` or numeric value
  3. In `updateAlertState` overdue branch: change `Number.parseInt(existing.overdueDaysNotified ?? '0', 10)` → `existing.overdueDaysNotified ?? 0` (already a number); change `String(current + 1)` → `current + 1`
  4. In `checkOverdue`: change `Number.parseInt(existing?.overdueDaysNotified ?? '0', 10)` → `existing?.overdueDaysNotified ?? 0`

  **Note**: The `updates` object currently uses `Record<string, string | null>`. This will need to become `Record<string, string | number | null>` or, better, switch to typed Drizzle `set()` calls to avoid untyped record manipulation.

- **Estimate**: 0.5h ±0.25h | **Priority**: Critical
- **Acceptance Criteria**:
  - No `Number.parseInt` or `String()` conversions for `overdueDaysNotified`
  - `bun typecheck` passes
  - `bun test tests/proactive/service.test.ts` passes
- **Dependencies**: Task 2.1

#### Task 2.3 — Add `ReminderStatus` type (F2)

- **File**: `src/proactive/types.ts`
- **Change**: Add `export type ReminderStatus = 'pending' | 'delivered' | 'snoozed' | 'cancelled'`
- **Estimate**: 0.1h ±0 | **Priority**: High
- **Dependencies**: None

#### Task 2.4 — Use `ReminderStatus` in `src/proactive/reminders.ts`

- **File**: `src/proactive/reminders.ts`
- **Change**:
  1. Import `ReminderStatus` from `./types.js`
  2. In `createReminder`: type the `status` field as `ReminderStatus` (value is `'pending'` — no runtime change)
  3. In `cancelReminder`: type the set value as `satisfies { status: ReminderStatus }` or equivalent
  4. In `snoozeReminder`, `rescheduleReminder`, `markDelivered`: same pattern
  5. In `listReminders`: type `validStatuses` as `ReminderStatus[]`

  This is a types-only change — no runtime behavior change.

- **Estimate**: 0.25h ±0 | **Priority**: High
- **Acceptance Criteria**: All status string literals are validated against `ReminderStatus` at compile time; `bun typecheck` passes
- **Dependencies**: Task 2.3

---

### Phase 3 — Implement `checkBlocked` (F5)

#### Task 3.1 — Implement `checkBlocked` in `src/proactive/service.ts`

- **File**: `src/proactive/service.ts`
- **Change**: Add a new exported function:

  ```typescript
  export async function checkBlocked(
    userId: string,
    task: TaskListItem,
    timezone: string,
    provider: TaskProvider,
  ): Promise<string | null>
  ```

  Logic:
  1. If task has no due date or due date > tomorrow → return `null`
  2. If task is terminal → return `null`
  3. If suppressed → return `null`
  4. If provider does not support `tasks.relations` capability → return `null` (can't check blockers)
  5. Call `provider.getTask(task.id)` to fetch full task with relations
  6. Filter relations for `type === 'blocked_by'`
  7. For each blocker: call `provider.getTask(blockerTaskId)` to check if the blocker is non-terminal
  8. If any non-terminal blocker found: update alert state, return message: `"🚧 [task] is due in ≤1 day but blocked by [blocker], which is still [status]."`
  9. Otherwise → return `null`

  **Note**: `checkBlocked` is `async` (unlike the other check functions) because it needs to call `provider.getTask()`. This means `runAlertCycle` must handle it differently — it cannot be part of the synchronous `flatMap` chain.

- **Estimate**: 1h ±0.5h | **Priority**: Medium
- **Acceptance Criteria**:
  - Returns alert when task is due ≤ tomorrow, has a `blocked_by` relation, and blocker is non-terminal
  - Returns `null` when blocker is terminal (done/completed/cancelled)
  - Returns `null` when provider lacks `tasks.relations` capability
  - Returns `null` when task has no due date
  - Respects suppression window
- **Dependencies**: Tasks 1.2 (shared utilities imported)

#### Task 3.2 — Wire `checkBlocked` into `runAlertCycle`

- **File**: `src/proactive/service.ts`
- **Change**: In `runAlertCycle`, after the synchronous `flatMap` that produces `allAlerts`, add a second pass for async blocked checks:

  ```typescript
  // Blocked checks require async provider calls
  const blockedAlerts: string[] = []
  for (const task of allTasks) {
    const blockedMsg = await checkBlocked(userId, task, timezone, provider)
    if (blockedMsg !== null) blockedAlerts.push(blockedMsg)
  }
  const allAlerts = [...syncAlerts, ...blockedAlerts]
  ```

  Rename the existing `allAlerts` variable to `syncAlerts` for clarity.

- **Estimate**: 0.25h ±0 | **Priority**: Medium
- **Acceptance Criteria**: `runAlertCycle` calls `checkBlocked` for each task; blocked alerts are sent alongside deadline/overdue/staleness alerts
- **Dependencies**: Task 3.1

#### Task 3.3 — Add `checkBlocked` tests

- **File**: `tests/proactive/service.test.ts`
- **Change**: Add new `describe('checkBlocked', ...)` block with test cases:
  1. `returns null when task has no due date`
  2. `returns null when task is not due within 1 day`
  3. `returns null when provider lacks tasks.relations capability`
  4. `returns alert when blocker is non-terminal and task due ≤ tomorrow`
  5. `returns null when blocker is terminal`
  6. `returns null when task is already suppressed`

  These tests need a mock `TaskProvider` that supports `getTask()` returning relation data. Use the existing `createMockProvider` from `tests/tools/mock-provider.ts`, extending it with `getTask` returning a `Task` object with `relations: [{ type: 'blocked_by', taskId: 'blocker-1' }]`.

- **Estimate**: 1h ±0.25h | **Priority**: Medium
- **Dependencies**: Task 3.1

---

### Phase 4 — Briefing Fixes (F6, F7, F8)

#### Task 4.1 — Add missing briefing sections to `buildSections` (F6)

- **File**: `src/proactive/briefing.ts`
- **Change**: Extend `buildSections` to produce three additional sections beyond the current three (Due Today, Overdue, In Progress): 4. **Recently Updated**: Tasks whose status in the `alert_state` table changed within the last 24 hours. This requires a new parameter: `buildSections(tasks, timezone, alertStates?)` where `alertStates` is an optional map of `taskId → AlertStateRow`. If provided, filter for tasks where `lastStatusChangedAt` is within the last 24h. 5. **Newly Assigned**: Tasks with `createdAt` within the last 24h (when available from `TaskListItem`). Since `TaskListItem` does not include `createdAt`, this section requires fetching full task details. For MVP: skip this section if `createdAt` is not available on `TaskListItem`. Add a comment noting this limitation. 6. **Suggested Actions**: Already implemented in `formatFull` via `suggestActions()`. Move it into the `buildSections` return so that `formatShort` can also count suggested actions. Actually — per the plan, Suggested Actions is only rendered in `formatFull`. No change needed here.

  **Practical scope**: Add "Recently Updated" section. Document "Newly Assigned" as a known limitation (requires `createdAt` which `TaskListItem` doesn't carry).

  Implementation:
  1. Accept optional `alertStateRows` parameter in `buildSections`
  2. Import `alertState` table and `getDrizzleDb` (or accept pre-fetched rows)
  3. For each non-terminal task, check if its `alert_state.lastStatusChangedAt` is within the last 24h
  4. Add these tasks to a "Recently Updated" section
  5. Caller (`generate`) fetches alert state rows for the user and passes them in

- **Estimate**: 1h ±0.5h | **Priority**: Medium
- **Acceptance Criteria**:
  - `buildSections` includes a "Recently Updated" section when applicable
  - Tasks already in "Due Today" or "Overdue" are not duplicated in "Recently Updated"
  - `formatShort` includes the "recently updated" count
  - Existing tests continue to pass; new test added for "Recently Updated"
- **Dependencies**: Task 1.3 (shared imports)

#### Task 4.2 — Split `generate` to not update state, add `generateAndRecord` (F7)

- **File**: `src/proactive/briefing.ts`
- **Change**: The `get_briefing` tool (manual trigger) must NOT update `user_briefing_state`, but the scheduled briefing and catch-up MUST update it. Split the concern:
  1. Rename current `generate` to `generateBriefingContent` (or keep as `generate`) — this pure function generates the briefing markdown but does NOT write to `user_briefing_state`.
  2. Extract the `user_briefing_state` upsert into a separate function `recordBriefingDelivery(userId: string, timezone: string): void`.
  3. Create a wrapper `generateAndRecord(userId, provider, mode)` that calls `generate` then `recordBriefingDelivery`. This is what the scheduler and catch-up hook call.
  4. The `get_briefing` tool calls `generate` directly (no state update).

  Callers:
  - `src/proactive/tools.ts` `makeGetBriefingTool` → calls `briefingService.generate()` (no state update) ✓
  - `src/proactive/scheduler.ts` `fireBriefingIfDue` → calls `briefingService.generateAndRecord()` (with state update)
  - `src/proactive/briefing.ts` `getMissedBriefing` → calls `generateAndRecord()` internally (with state update)

- **Estimate**: 0.5h ±0.25h | **Priority**: Medium
- **Acceptance Criteria**:
  - `generate()` does NOT write to `user_briefing_state`
  - `generateAndRecord()` writes to `user_briefing_state`
  - `get_briefing` tool uses `generate()` — manual briefing does not suppress the scheduled one
  - `getMissedBriefing` uses `generateAndRecord()` — catch-up is recorded so it doesn't fire twice
  - Scheduled briefing in `scheduler.ts` uses `generateAndRecord()`
  - Existing tests updated to match new function names
- **Dependencies**: None

#### Task 4.3 — Fix `suggestActions` array mutation (F8)

- **File**: `src/proactive/briefing.ts`
- **Change**: In `suggestActions`, replace `.sort(sortByPriority)` (in-place mutation) with `.toSorted(sortByPriority)` (returns a new array, does not mutate input). `Array.prototype.toSorted` is available in ES2023+ (Bun supports it).

  Change:

  ```typescript
  // Before
  const sorted = [...overdueTasks.sort(sortByPriority), ...dueTodayTasks.sort(sortByPriority)]
  // After
  const sorted = [...overdueTasks.toSorted(sortByPriority), ...dueTodayTasks.toSorted(sortByPriority)]
  ```

- **Estimate**: 0.1h ±0 | **Priority**: Low
- **Acceptance Criteria**: `suggestActions` does not mutate the `tasks` arrays in the input sections; existing tests pass
- **Dependencies**: None

---

### Phase 5 — Error Pattern Consolidation (F9)

#### Task 5.1 — Replace `ReminderNotFoundError` with `AppError` pattern

- **File**: `src/proactive/reminders.ts`
- **Change**:
  1. Remove the `ReminderNotFoundError` class
  2. Import `providerError` from `../errors.js`
  3. Replace `throw new ReminderNotFoundError(reminderId)` with `throw providerError.notFound('reminder', reminderId)` in `cancelReminder`, `snoozeReminder`, `rescheduleReminder`
  4. Export a type guard or the error type if needed

- **File**: `src/proactive/tools.ts`
- **Change**:
  1. Remove import of `ReminderNotFoundError`
  2. Import `isAppError` from `../errors.js`
  3. Update `handleReminderError` to check `isAppError(error) && error.type === 'provider' && error.code === 'not-found'` instead of `error instanceof ReminderNotFoundError`

- **Estimate**: 0.5h ±0.25h | **Priority**: Low
- **Acceptance Criteria**:
  - `ReminderNotFoundError` class no longer exists
  - Ownership violations throw `ProviderError` with code `'not-found'`
  - Tool error handling still returns `{ error: "..." }` objects to the LLM
  - `bun test tests/proactive/reminders.test.ts` — update the `expect().toThrow(ReminderNotFoundError)` assertion to use the new error type
  - `bun test tests/proactive/tools.test.ts` passes unchanged
- **Dependencies**: None

---

### Phase 6 — Scheduler Fixes (F10, F11, F12)

#### Task 6.1 — Replace `_briefingJobs` export with `getBriefingJobCount()` accessor (F11)

- **File**: `src/proactive/scheduler.ts`
- **Change**:
  1. Remove `export const _briefingJobs = briefingJobs`
  2. Add `export function getBriefingJobCount(): number { return briefingJobs.size }`

- **File**: `tests/proactive/scheduler.test.ts`
- **Change**: Replace all `_briefingJobs.size` references with `getBriefingJobCount()`.

- **Estimate**: 0.25h ±0 | **Priority**: Low
- **Dependencies**: None

#### Task 6.2 — Fix scheduler test isolation (F10)

- **File**: `tests/proactive/scheduler.test.ts`
- **Change**:
  1. Remove the `spyOn(globalThis, 'setInterval')` approach in the "start registers 2 global poller jobs" test. It is fragile because the spy accumulates across the entire test file.
  2. Instead, verify the start behavior by asserting that `getBriefingJobCount()` is `0` after start with no briefing-configured users, and that `stopAll()` can be called without error. The "2 global pollers" assertion is implicitly verified by the fact the scheduler works (reminders get polled, alerts get polled) — tested in integration tests.
  3. Alternatively: create a fresh `setInterval` spy in `beforeEach` and restore it in `afterEach`:
     ```typescript
     let intervalSpy: ReturnType<typeof spyOn>
     beforeEach(() => {
       intervalSpy = spyOn(globalThis, 'setInterval')
     })
     afterEach(() => {
       intervalSpy.mockRestore()
       stopAll()
     })
     ```
     This ensures each test gets a clean spy count.

- **Estimate**: 0.25h ±0 | **Priority**: Medium
- **Dependencies**: Task 6.1

#### Task 6.3 — Add initial `pollAlerts()` call on startup (F12)

- **File**: `src/proactive/scheduler.ts`
- **Change**: After the existing `void pollReminders()` at the end of `start()`, add `void pollAlerts()` so that alerts are checked immediately on startup, not deferred until the first hourly interval.

  ```typescript
  // Run initial polls immediately
  void pollReminders()
  void pollAlerts()
  ```

- **Estimate**: 0.1h ±0 | **Priority**: Low
- **Dependencies**: None

---

### Phase 7 — Test Coverage Gaps (F13)

#### Task 7.1 — Add `runAlertCycleForAllUsers` test

- **File**: `tests/proactive/service.test.ts`
- **Change**: Add `describe('runAlertCycleForAllUsers', ...)` with:
  1. `skips users without deadline_nudges = enabled` — mock `listUsers` to return 2 users, mock `getConfig` to return `'enabled'` for one and `null` for the other, verify `sendFn` is only called for the enabled user's tasks.

  This requires mocking `listUsers` and `getConfig` at the module level (already done in the test file's mock setup). Add a test that configures one user as enabled and one as disabled, then verifies only the enabled user's alerts are processed.

- **Estimate**: 0.5h ±0.25h | **Priority**: Medium
- **Dependencies**: None

#### Task 7.2 — Add scheduler delivery & error tests

- **File**: `tests/proactive/scheduler.test.ts`
- **Change**: Add the missing planned test cases:
  1. `briefing callback error is caught and logged, not rethrown` — Register a briefing job, mock the provider to throw, manually trigger `fireBriefingIfDue` (or use a short timer), verify no unhandled rejection occurs and error is logged.
  2. `alert poller callback error is caught and logged, not rethrown` — Similar: mock `runAlertCycleForAllUsers` to throw, trigger `pollAlerts`, verify error is caught.
  3. `reminder poller marks reminder as delivered after sending` — Create a reminder with past `fire_at`, trigger `pollReminders`, verify reminder status is `'delivered'`.
  4. `reminder poller calls advanceRecurrence for recurring reminder after delivery` — Create a recurring reminder with past `fire_at`, trigger `pollReminders`, verify `fire_at` advanced and status is `'pending'`.

  **Note**: Some of these require calling internal functions. Since `pollReminders` and `pollAlerts` are module-private, either:
  - (a) Export them as `_pollReminders` / `_pollAlerts` for testing (with `@internal` JSDoc), or
  - (b) Test indirectly by calling `start()`, waiting for the interval to fire, and asserting side effects.

  Option (a) is simpler and consistent with the existing `_briefingJobs` pattern (which we're refactoring to an accessor anyway). Export thin test-only accessors.

- **Estimate**: 1.5h ±0.5h | **Priority**: Medium
- **Dependencies**: Tasks 6.1, 6.2

#### Task 7.3 — Add `buildSections` "Recently Updated" test

- **File**: `tests/proactive/briefing.test.ts`
- **Change**: Add test case:
  1. `buildSections includes Recently Updated section for tasks with recent status changes` — Insert alert_state rows with `lastStatusChangedAt` within the last 24h, pass tasks, verify the "Recently Updated" section is present.
  2. `buildSections excludes tasks from Recently Updated if already in Due Today or Overdue` — Ensure no double-counting.

- **Estimate**: 0.5h ±0.25h | **Priority**: Medium
- **Dependencies**: Task 4.1

#### Task 7.4 — Update `get_briefing` tool test to verify no state update

- **File**: `tests/proactive/tools.test.ts`
- **Change**: Add test case:
  1. `get_briefing does not update user_briefing_state` — Call `get_briefing` tool, then check `user_briefing_state` table — it should have no row for the user (or the existing row should be unchanged).

- **Estimate**: 0.25h ±0 | **Priority**: Medium
- **Dependencies**: Task 4.2

#### Task 7.5 — Update reminders test for `AppError` pattern

- **File**: `tests/proactive/reminders.test.ts`
- **Change**: Update `expect(() => cancelReminder(r.id, otherUser)).toThrow(ReminderNotFoundError)` to use the new error pattern:
  - Import `isAppError` from `../../src/errors.js`
  - Change assertion to `expect(() => cancelReminder(r.id, otherUser)).toThrow()` and verify the thrown error satisfies `isAppError(e) && e.code === 'not-found'`

- **Estimate**: 0.25h ±0 | **Priority**: Low
- **Dependencies**: Task 5.1

---

## Task Dependency Graph

```
Phase 1 (shared utilities)         Phase 2 (schema/types)       Phase 4–6 (independent)
  Task 1.1 ─┬─ Task 1.2             Task 2.1 ─── Task 2.2       Task 4.3 (sort fix)
             ├─ Task 1.3             Task 2.3 ─── Task 2.4       Task 6.3 (initial poll)
             └─ Task 1.4
                  │
                  ▼
             Task 3.1 (checkBlocked)
             Task 3.2 (wire into runAlertCycle)
             Task 3.3 (tests)

Phase 4 (briefing)                 Phase 5 (error pattern)      Phase 6 (scheduler)
  Task 4.1 (sections)               Task 5.1 ─── Task 7.5       Task 6.1 ─── Task 6.2
  Task 4.2 (generate split)                                               ─── Task 7.2
       └─── Task 7.4
  Task 4.1 ─── Task 7.3
```

**Critical path**: Phase 1 → Phase 3 (checkBlocked depends on shared utilities)

**Parallelizable work**:

- Phase 1 and Phase 2 can run in parallel
- Phase 4, Phase 5, and Phase 6 can run in parallel (after Phase 1)
- Phase 7 test tasks run after their respective implementation tasks

---

## Risk Assessment Matrix

| Risk                                                                  | Probability | Impact | Mitigation                                                                                            |
| --------------------------------------------------------------------- | ----------- | ------ | ----------------------------------------------------------------------------------------------------- |
| `overdueDaysNotified` type change breaks existing DB data             | Low         | Medium | SQLite type affinity means existing `'0'` string values read as integer `0` — no migration needed     |
| `checkBlocked` calls `getTask` per-task, causing N+1 queries          | Medium      | Medium | Only check tasks due ≤ tomorrow (small subset); short-circuit on capability check; cap at 20 projects |
| Splitting `generate`/`generateAndRecord` breaks scheduler integration | Low         | High   | Run full test suite after change; scheduler test explicitly verifies `generateAndRecord` is called    |
| Removing `ReminderNotFoundError` breaks downstream error handling     | Low         | Low    | `AppError` pattern is well-established; `isAppError` guard catches all cases; tests verify            |
| "Recently Updated" section depends on `alert_state` data              | Low         | Low    | Graceful degradation: if no alert_state rows exist, section is simply empty (omitted from briefing)   |

---

## Resource Requirements

- **Development Hours**: 8h ±2h total (2–3 working days)
- **New Production Dependencies**: None
- **New Source Files**: 1 (`src/proactive/shared.ts`)
- **Modified Source Files**: `src/db/schema.ts`, `src/proactive/service.ts`, `src/proactive/briefing.ts`, `src/proactive/reminders.ts`, `src/proactive/tools.ts`, `src/proactive/scheduler.ts`, `src/proactive/types.ts`, `src/proactive/index.ts`
- **Modified Test Files**: `tests/proactive/service.test.ts`, `tests/proactive/briefing.test.ts`, `tests/proactive/scheduler.test.ts`, `tests/proactive/tools.test.ts`, `tests/proactive/reminders.test.ts`
- **New Test Cases**: ~15 new tests across existing test files
- **Database Migration**: None required (SQLite type affinity handles the `text → integer` Drizzle schema change without a DDL migration)

---

## Validation Checklist

- [ ] `bun run typecheck` passes with zero errors
- [ ] `bunx oxlint src/proactive/` reports zero warnings and zero errors
- [ ] `bun test tests/proactive/` — all existing tests pass; new tests pass
- [ ] `bun test` (full suite) — no regressions
- [ ] No `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, or `oxlint-disable` comments in any modified file
- [ ] `grep -r 'TERMINAL_STATUS_SLUGS' src/proactive/` returns exactly one file (`shared.ts`)
- [ ] `grep -r 'isTerminalStatus' src/proactive/` returns imports only in `service.ts` and `briefing.ts`, definition only in `shared.ts`
- [ ] `grep -r 'ReminderNotFoundError' src/` returns zero results
- [ ] `grep -r '_briefingJobs' src/` returns zero results
- [ ] Manual smoke test: `get_briefing` tool invocation does not prevent the next scheduled briefing from firing
