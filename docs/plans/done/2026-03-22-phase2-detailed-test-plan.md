# Phase 2: Fill Critical Module Gaps — Detailed Test Plan

**Date:** 2026-03-22
**Status:** Draft
**Parent:** [Test Improvement Roadmap](2026-03-22-test-improvement-roadmap.md)
**Prerequisite:** Phase 1 (Fix False-Confidence Tests) completed
**Goal:** Modules that affect every request or run autonomously have meaningful behavioral coverage

---

## Executive Summary

Phase 2 targets 4 areas of critical, under-tested business logic. These modules operate at the core of the application — the scheduler runs autonomously creating tasks on a timer, `processMessage` is the entry point for every user interaction, and `completionHook` triggers follow-up task creation. Bugs in these paths are invisible until they hit production.

| Area                                            |     Current State      | Root Cause                                                                                                                                         | Tests Today | Tests After |
| ----------------------------------------------- | :--------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------- | :---------: | :---------: |
| `scheduler.ts`                                  | 1 test, score **2/10** | Only tests the in-flight guard; no coverage of `tick()` happy path, error resilience, `createMissedTasks`, `startScheduler`/`stopScheduler`        |      1      |    14–16    |
| `update-task.ts` + `completionHook` integration | Zero integration tests | `completion-hook.test.ts` tests the hook in isolation; `task-tools.test.ts` never passes a `completionHook` to `makeUpdateTaskTool`                |      0      |      4      |
| `processMessage` error handling                 |       Zero tests       | `llm-orchestrator-errors.test.ts` tests pure error classification but never exercises `processMessage` catch block or `handleMessageError` routing |      0      |     6–8     |
| Untested exported functions                     |    Zero tests each     | `allOccurrencesBetween`, `appendHistory`, `getKaneoWorkspace`/`setKaneoWorkspace` simply never had tests written                                   |      0      |    10–12    |

---

## Task 2.1 — Expand `tests/scheduler.test.ts`

### Problem Analysis

The scheduler is an autonomous background process that runs every 60 seconds. It queries the database for due recurring tasks, builds a task provider for each user, creates task instances via the provider API, applies labels, records occurrences, and notifies users. Failures are logged but invisible to users unless they notice a missing task.

The existing test file has a single `describe` block with 1 test: "second concurrent tick is skipped while first is still running". This tests the in-flight guard (`activeTickPromise` deduplication) but never verifies that `tick()` actually creates tasks, handles errors, or that `createMissedTasks` works at all.

### Source Code Under Test

[src/scheduler.ts](../../src/scheduler.ts) exports:

```typescript
tick(): Promise<void>
createMissedTasks(recurringTaskId: string, missedDates: readonly string[]): Promise<number>
startScheduler(chatProvider: ChatProvider): void
stopScheduler(): void
```

Internal functions (tested indirectly through `tick()`):

- `buildProviderForUser(userId)` → reads config from cache, builds `TaskProvider`
- `executeRecurringTask(task)` → creates task, applies labels, records occurrence, marks executed, notifies user
- `applyLabels(provider, taskId, labels)` → calls `provider.addTaskLabel` for each label
- `notifyUser(userId, created)` → sends chat message via `chatProviderRef`

### Existing Infrastructure to Reuse

The existing test file already sets up:

- In-memory SQLite with `recurring_tasks` table (manual DDL)
- `mock.module` for `../src/providers/registry.js` → returns mock provider
- `mock.module` for `../src/db/drizzle.js` → returns test DB
- `setCachedConfig` for user API key
- `setKaneoWorkspace` for user workspace ID
- `createRecurringTask` to insert a due task

**Note:** The existing test uses manual DDL for the `recurring_tasks` table. This is fragile (risk of schema drift with production). Consider migrating to `setupTestDb()` with full migrations in Phase 6 (Task 6.1.2). For Phase 2, extend the existing pattern to minimize scope.

### Detailed Test Specifications

#### Required Setup Changes

The existing mock provider only exposes `createTask`. To test label application, notifications, and error paths, the mock needs extending:

```
// Extend mock provider factory
let mockProvider: {
  capabilities: Set<string>
  createTask: Mock
  addTaskLabel?: Mock
}

// Add chatProvider mock for notifyUser tests
let chatSendMessageCalls: Array<{ userId: string; text: string }>
const mockChatProvider = {
  sendMessage: (userId, text) => {
    chatSendMessageCalls.push({ userId, text })
    return Promise.resolve()
  },
  ...
}
```

Also need:

- `recurring_task_occurrences` table DDL added to `beforeEach` (for `recordOccurrence`)
- Access to `markExecuted` assertions via DB state check
- A helper to create tasks with specific `nextRun` values

#### Test Block: "tick() — happy path"

| #   | Test Name                                                    | Setup                                              | Expected Behavior                                                                                                             | Assertion Pattern                                                                                       |
| --- | ------------------------------------------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | `tick()` with no due tasks → no provider calls               | Create task with `nextRun` in the future (not due) | `tick()` resolves, `createTask` not called                                                                                    | `expect(createTaskCallCount).toBe(0)`                                                                   |
| 2   | `tick()` with one due task → creates task instance           | Create task with `nextRun` in the past             | Provider `createTask` called once with correct params (`projectId`, `title`, `description`, `priority`, `status`, `assignee`) | `toHaveBeenCalledWith` on `createTask` mock verifying all fields from the recurring task record         |
| 3   | `tick()` marks task as executed after creation               | Create due task, run `tick()`, resolve createTask  | Query DB: `lastRun` is updated, `nextRun` recomputed to next cron occurrence                                                  | `testSqlite.query` on `recurring_tasks` table checking `last_run IS NOT NULL` and `next_run > last_run` |
| 4   | `tick()` records occurrence linking template to created task | Create due task, run `tick()`                      | Query DB: `recurring_task_occurrences` table has row with matching `templateId` and `taskId`                                  | `testSqlite.query` on `recurring_task_occurrences` checking row count = 1                               |

**Kill-detection:** If `executeRecurringTask` is replaced with a no-op, tests 2–4 all fail (no provider call, no DB update, no occurrence record).

#### Test Block: "tick() — error resilience"

| #   | Test Name                                                                           | Setup                                                                          | Expected Behavior                                                                      | Assertion Pattern                                                                                 |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 5   | `tick()` when provider `createTask` throws → error caught, task NOT marked executed | Mock `createTask` to reject with `Error('API down')`                           | `tick()` resolves (no throw), `lastRun` remains NULL, `nextRun` unchanged              | `tick()` does not reject; DB query shows `last_run IS NULL`                                       |
| 6   | `tick()` continues processing remaining tasks after one fails                       | Create 2 due tasks; mock `createTask` to fail on first call, succeed on second | First task: NOT marked executed. Second task: marked executed with occurrence recorded | Check DB: first task `last_run IS NULL`, second task `last_run IS NOT NULL`; occurrence count = 1 |

**Implementation note for test 6:** The existing test infrastructure creates a single task per `beforeEach`. To create 2 due tasks, call `createRecurringTask` twice with distinct `userId` + config, or with same user and two different recurring task records. Since `tick()` processes sequentially via `reduce`, the mock can track call count and fail on the first call:

```
let callCount = 0
createTask: () => {
  callCount++
  if (callCount === 1) return Promise.reject(new Error('API down'))
  return Promise.resolve({ id: 'new-task-2', ... })
}
```

**Kill-detection:** If the try/catch in `executeRecurringTask` is removed, test 5 fails (unhandled rejection). If the sequential reduce is replaced with `Promise.all`, test 6 behavior may change (both fail instead of partial success).

#### Test Block: "tick() — label application"

| #   | Test Name                                                            | Setup                                                                                                                                  | Expected Behavior                            | Assertion Pattern                               |
| --- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------- |
| 7   | `tick()` applies labels when provider supports `labels.assign`       | Create due task with `labels: '["label-1","label-2"]'`; mock provider with `capabilities.has('labels.assign')` and `addTaskLabel` mock | `addTaskLabel` called twice (once per label) | `expect(addTaskLabel).toHaveBeenCalledTimes(2)` |
| 8   | `tick()` skips label application when provider lacks `labels.assign` | Same as above but `capabilities` set does NOT include `'labels.assign'`                                                                | `addTaskLabel` NOT called                    | `expect(addTaskLabel).not.toHaveBeenCalled()`   |

**Implementation note:** The existing mock provider has `capabilities: new Set<string>()` (empty). For test 7, override to include `'labels.assign'`. For test 8, keep empty set.

The recurring task's `labels` column is stored as a JSON string. When inserting via `createRecurringTask`, pass `labels: ['label-1', 'label-2']` in the input. Verify the `createRecurringTask` input type accepts labels — [src/types/recurring.ts](../../src/types/recurring.ts) should have `labels?: string[]`.

#### Test Block: "tick() — user notification"

| #   | Test Name                                   | Setup                                                                         | Expected Behavior                                                                      | Assertion Pattern                                                                                       |
| --- | ------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 9   | `tick()` notifies user after task creation  | Set `chatProviderRef` via `startScheduler(mockChatProvider)`, create due task | `chatProvider.sendMessage` called with `(userId, text)` where text contains task title | Assert `chatSendMessageCalls` has 1 entry with matching `userId` and text containing `'Recurring Test'` |
| 10  | `tick()` continues when `notifyUser` throws | Mock `chatProvider.sendMessage` to reject                                     | `tick()` resolves, task is still marked executed, occurrence still recorded            | `tick()` does not reject; DB shows `last_run IS NOT NULL`                                               |

**Implementation note:** `notifyUser` has its own try/catch, so notification failure should never block task creation. The key assertion is that `markExecuted` and `recordOccurrence` succeed regardless.

#### Test Block: "tick() — provider build failure"

| #   | Test Name                                                        | Setup                                                                 | Expected Behavior                                                    | Assertion Pattern                                   |
| --- | ---------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------- |
| 11  | `tick()` when `buildProviderForUser` returns null → task skipped | Clear user config so `getConfig(userId, 'kaneo_apikey')` returns null | `tick()` resolves, `createTask` not called, task NOT marked executed | `createTaskCallCount === 0`; DB: `last_run IS NULL` |

**Implementation note:** `buildProviderForUser` returns null when any of `kaneoKey`, `kaneoBaseUrl`, or `workspaceId` is missing. Clear the config via `clearUserCache(USER_ID)` without re-seeding.

#### Test Block: "createMissedTasks"

| #   | Test Name                                                                                      | Setup                                             | Expected Behavior                                                 | Assertion Pattern                                                                     |
| --- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 12  | `createMissedTasks` with 3 missed dates → 3 tasks created                                      | Create recurring task, provide 3 ISO date strings | Returns `3`; `createTask` called 3 times; 3 occurrence rows in DB | `expect(result).toBe(3)`, `createTask.mock.calls.length === 3`, occurrences count = 3 |
| 13  | `createMissedTasks` where one creation fails → continues with remaining, returns partial count | Mock `createTask` to fail on 2nd of 3 calls       | Returns `2`; 2 occurrences recorded, 1 skipped                    | `expect(result).toBe(2)`                                                              |
| 14  | `createMissedTasks` with empty `missedDates` → returns 0, no provider calls                    | Pass `[]`                                         | Returns `0`; `createTask` not called                              | `expect(result).toBe(0)`, `createTaskCallCount === 0`                                 |
| 15  | `createMissedTasks` with non-existent recurring task ID → returns 0                            | Pass ID that doesn't exist in DB                  | Returns `0`; `createTask` not called                              | `expect(result).toBe(0)`                                                              |

**Kill-detection:** If `createMissedTasks` is replaced with `return 0`, tests 12–13 fail (zero create calls, wrong return value). If error handling in `createOne` is removed, test 13 fails (unhandled rejection).

#### Test Block: "startScheduler / stopScheduler"

| #   | Test Name                                           | Setup                                          | Expected Behavior                    | Assertion Pattern                                                                     |
| --- | --------------------------------------------------- | ---------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------- |
| 16  | `startScheduler` double-call → second call is no-op | Call `startScheduler(mockChat)` twice          | No error; log warning on second call | No throw; can verify by checking only one interval is active (stop clears it)         |
| 17  | `stopScheduler` → clears interval, nulls references | Call `startScheduler()` then `stopScheduler()` | After stop: scheduling is disabled   | Call `tick()` after stop — if `chatProviderRef` is null, notification path is skipped |

**Implementation note:** Testing `setInterval`/`clearInterval` timing is fragile and unnecessary. Test the guard logic only — that `startScheduler` sets state correctly and `stopScheduler` clears it. Do NOT test that `tick()` is called every 60 seconds.

**Important cleanup:** After each test that calls `startScheduler`, call `stopScheduler()` in `afterEach` to prevent interval leaks across tests.

### Additional Setup: `recurring_task_occurrences` Table

The existing `beforeEach` creates only the `recurring_tasks` table. For tests 4, 12, and 13 (which verify `recordOccurrence`), also create:

```sql
CREATE TABLE IF NOT EXISTS recurring_task_occurrences (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')) NOT NULL
)
```

### Risks & Mitigations

| Risk                                                                                    | Probability | Impact | Mitigation                                                                                   |
| --------------------------------------------------------------------------------------- | :---------: | :----: | -------------------------------------------------------------------------------------------- |
| `scheduler.ts` has deep dependency tree (provider registry, DB, cache, chat)            |    High     | Medium | Existing `mock.module` pattern handles this; extend don't rebuild                            |
| `setInterval`/`clearInterval` timing in tests                                           |   Medium    |  Low   | DON'T test timing — test `tick()` directly as a unit; test `start/stop` only for guard logic |
| Mock provider needs per-test configuration (some tests need `addTaskLabel`, some don't) |   Medium    |  Low   | Create a `makeMockProvider(overrides)` factory function inside the test file                 |
| `createMissedTasks` sequential processing order matters for partial-failure test        |     Low     |  Low   | The function uses `reduce` (sequential), so mock can rely on call order                      |
| `startScheduler` leaking intervals into other tests                                     |   Medium    |  High  | Always call `stopScheduler()` in `afterEach`                                                 |

### Acceptance Criteria

- [ ] `scheduler.test.ts` has ≥14 tests across 7 describe blocks
- [ ] `tick()` happy path verifies: provider called, task marked executed, occurrence recorded
- [ ] `tick()` error resilience: provider failure does not crash scheduler, task is NOT marked executed
- [ ] `tick()` with labels: labels applied when supported, skipped when not
- [ ] `createMissedTasks` covers: happy path, partial failure, empty list, non-existent task
- [ ] `startScheduler` / `stopScheduler` guard logic tested without timing assertions
- [ ] `afterEach` calls `stopScheduler()` to prevent interval leaks
- [ ] `bun test tests/scheduler.test.ts` passes
- [ ] No `eslint-disable`, `@ts-ignore`, or `@ts-nocheck`

---

## Task 2.2 — Add `completionHook` Integration Tests to `tests/tools/task-tools.test.ts`

### Problem Analysis

`makeUpdateTaskTool` in [src/tools/update-task.ts](../../src/tools/update-task.ts) accepts an optional `completionHook` callback. When a task is updated and the returned task has a `status` field, the hook fires:

```typescript
if (completionHook !== undefined && task.status !== undefined) {
  await completionHook(taskId, task.status, provider)
}
```

The hook is responsible for triggering `on_complete` recurring task creation — a critical workflow. [tests/tools/completion-hook.test.ts](../../tests/tools/completion-hook.test.ts) tests the `completionHook` function in isolation (6 tests, score 8.5/10), but no test verifies that `makeUpdateTaskTool` correctly invokes the hook. The integration path is untested.

Specifically, the behavior around `task.status !== undefined` is subtle. The `updateTask` provider method returns the **full updated task object**, not just the fields that were changed. So `task.status` is always defined on the response (it's a required `Task` field). This means the hook fires on **every** update, not just status changes. This may or may not be intentional — the tests should document the actual behavior.

### Source Code Under Test

[src/tools/update-task.ts](../../src/tools/update-task.ts):

```typescript
export function makeUpdateTaskTool(provider: TaskProvider, completionHook?: CompletionHookFn): ToolSet[string]
```

The `execute` function:

1. Calls `provider.updateTask(taskId, { title, description, status, ... })`
2. If `completionHook !== undefined && task.status !== undefined` → calls `completionHook(taskId, task.status, provider)`
3. Returns the updated task

### Existing Test Coverage

`tests/tools/task-tools.test.ts` has 5 tests for `makeUpdateTaskTool`:

- "returns tool with correct structure"
- "updates task with single field"
- "updates task with multiple fields"
- "propagates API errors including 404"
- "validates taskId is required"

None of these pass a `completionHook` to `makeUpdateTaskTool`.

`tests/tools/completion-hook.test.ts` has 1 test for the integration:

- "no error when completionHook is not provided to makeUpdateTaskTool" — this only tests that omitting the hook doesn't break the tool, not that providing it works.

### Detailed Test Specifications

All new tests go in the existing `describe('makeUpdateTaskTool', ...)` block in `tests/tools/task-tools.test.ts`.

| #   | Test Name                                                                                                        | Setup                                                                                                                | Call                                                                                      | Expected Behavior                                                                                        | Assertion Pattern                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | `updateTask` with status change + `completionHook` → hook called with correct args                               | Mock `updateTask` returning `{ id: 'task-1', status: 'done', ... }`; create `completionHook` spy                     | `makeUpdateTaskTool(provider, hookSpy)` → `execute({ taskId: 'task-1', status: 'done' })` | `hookSpy` called once with `('task-1', 'done', provider)`                                                | `expect(hookSpy).toHaveBeenCalledWith('task-1', 'done', provider)`                            |
| 2   | `updateTask` with status change + `completionHook` throws → error propagates                                     | Mock `completionHook` to reject with `Error('hook error')`                                                           | `execute({ taskId: 'task-1', status: 'done' })`                                           | Promise rejects with 'hook error' (error is NOT swallowed)                                               | `expect(promise).rejects.toThrow('hook error')`                                               |
| 3   | `updateTask` with title-only change + `completionHook` → hook IS called (status always present on Task response) | Mock `updateTask` returning `{ id: 'task-1', status: 'todo', title: 'New Title', ... }`; create `completionHook` spy | `execute({ taskId: 'task-1', title: 'New Title' })`                                       | `hookSpy` called with `('task-1', 'todo', provider)` because `task.status !== undefined` on the response | `expect(hookSpy).toHaveBeenCalledTimes(1)`                                                    |
| 4   | `updateTask` with no `completionHook` → no error, normal update                                                  | No hook passed                                                                                                       | `makeUpdateTaskTool(provider)` → `execute({ taskId: 'task-1', status: 'done' })`          | Returns task, no error                                                                                   | `expect(result.status).toBe('done')` — this is the existing test 2, confirming it still works |

**Important behavioral observation for test 3:** The condition `task.status !== undefined` checks the **return value** from `provider.updateTask`, not the **input** `status` parameter. Since `Task` always has a `status` field, the hook fires on every successful update — not just status transitions. This test documents this behavior explicitly. If this turns out to be a bug (hook should only fire when the user explicitly changes status), the test should be updated accordingly after the fix.

**Alternative if behavior should be "hook only fires when input has status":** If the intent is that the hook only fires when the user explicitly changed the status, the condition should be `task.status !== undefined && status !== undefined` (checking the input `status` parameter). Test 3 would then assert `hookSpy` is NOT called. Document whichever behavior is observed and add a comment noting the design decision.

### Risks & Mitigations

| Risk                                                                                    | Probability | Impact | Mitigation                                                                                     |
| --------------------------------------------------------------------------------------- | :---------: | :----: | ---------------------------------------------------------------------------------------------- |
| `completionHook` is async — test must `await` the execute call to observe the hook call |     Low     | Medium | All existing tests already `await` the execute call                                            |
| Hook error propagation may change if wrapped in try/catch in the future                 |     Low     |  Low   | Test 2 documents the current contract (errors propagate); if behavior changes, test catches it |
| Ambiguity: does hook fire on every update or only status updates?                       |   Medium    | Medium | Test 3 explicitly documents actual behavior with an explanatory comment                        |

### Acceptance Criteria

- [ ] 4 new tests in `describe('makeUpdateTaskTool', ...)` block
- [ ] Test 1 verifies `completionHook` is called with exact `(taskId, status, provider)` arguments
- [ ] Test 2 verifies error propagation (hook throws → `execute` rejects)
- [ ] Test 3 documents behavior when status is not explicitly changed in input
- [ ] Test 4 confirms backward compatibility when no hook is provided (existing coverage reinforced)
- [ ] `bun test tests/tools/task-tools.test.ts` passes
- [ ] No lint suppressions

---

## Task 2.3 — Add `processMessage` Error-Handling Tests

### Problem Analysis

`processMessage` in [src/llm-orchestrator.ts](../../src/llm-orchestrator.ts) is the entry point for every user message. It:

1. Loads cached history and appends the new user message
2. Calls `callLlm()` (which checks config, builds provider, calls `generateText`)
3. On success: appends assistant messages to history, triggers trim if needed
4. On error: **restores original history** (`saveHistory(contextId, baseHistory)`) and calls `handleMessageError`

`handleMessageError` routes errors based on type:

- `isAppError(error)` → `getUserMessage(error)`
- `KaneoClassifiedError` → `getUserMessage(error.appError)`
- `YouTrackClassifiedError` → `getUserMessage(error.appError)`
- `ProviderClassifiedError` → `getUserMessage(error.error)`
- `APICallError` → generic "unexpected error" message
- Unknown errors → generic "unexpected error" message

The existing `llm-orchestrator-errors.test.ts` tests the pure error classification functions (`classifyKaneoError`, `getUserMessage`, error factories) but never exercises the `processMessage` → `handleMessageError` pipeline. A bug in the catch block or error routing would be invisible.

### Source Code Under Test

[src/llm-orchestrator.ts](../../src/llm-orchestrator.ts) exports:

```typescript
processMessage(reply: ReplyFn, contextId: string, username: string | null, userText: string): Promise<void>
```

### Testing Strategy

`processMessage` has many dependencies: `getConfig`, `getCachedHistory`, `buildProvider`, `generateText`, `makeTools`, `buildMessagesWithMemory`, etc. The most practical approach is to mock at the module level:

1. Mock `./config.js` → `getConfig()` returns controlled values per key
2. Mock `./cache.js` → `getCachedHistory()` returns empty or predefined history
3. Mock `./history.js` → `appendHistory()` and `saveHistory()` are spies
4. Mock `./conversation.js` → `buildMessagesWithMemory()` returns passthrough, `shouldTriggerTrim()` returns false
5. Mock `./memory.js` → `extractFactsFromSdkResults()` returns empty
6. Mock `./providers/registry.js` → `createProvider()` returns mock
7. Mock `./tools/index.js` → `makeTools()` returns empty toolset
8. Mock `./users.js` → `getKaneoWorkspace()` returns workspace ID
9. Mock `ai` module → `generateText()` is the key control point for success/failure
10. Mock `./providers/kaneo/provision.js` → `provisionAndConfigure()` returns resolved status

The `reply` parameter uses the existing `createMockReply()` helper.

### Detailed Test Specifications

#### Test Block: "processMessage — missing configuration"

| #   | Test Name                                          | Setup                                                   | Expected Behavior                                                      | Assertion Pattern                      |
| --- | -------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------- |
| 1   | Missing LLM config keys → reply lists missing keys | `getConfig` returns null for `llm_apikey`               | `reply.text` called with string containing `'llm_apikey'` and `'/set'` | `textCalls[0]` contains `'llm_apikey'` |
| 2   | Missing multiple config keys → reply lists all     | `getConfig` returns null for `llm_apikey`, `main_model` | Reply text contains both `'llm_apikey'` and `'main_model'`             | `textCalls[0]` contains both key names |

**Implementation note:** Mock `getConfig` to return null for specific keys. The `checkRequiredConfig` function checks `llm_apikey`, `llm_baseurl`, `main_model`, and the provider key (`kaneo_apikey` or `youtrack_token`). Return valid values for all other keys.

#### Test Block: "processMessage — LLM API error"

| #   | Test Name                                                          | Setup                                                | Expected Behavior                                                                  | Assertion Pattern                    |
| --- | ------------------------------------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------ |
| 3   | `generateText` throws `APICallError` → generic user-friendly reply | Mock `generateText` to throw `APICallError` instance | `reply.text` called with `'An unexpected error occurred. Please try again later.'` | Exact string match on `textCalls[0]` |

**Implementation note:** `APICallError` is from `@ai-sdk/provider`. To create one in tests:

```typescript
import { APICallError } from '@ai-sdk/provider'
// APICallError.isInstance() is the type guard used in handleMessageError
// Create via: new APICallError({ message: 'Rate limited', url: '...', requestBodyValues: {}, statusCode: 429, ... })
```

Check the `APICallError` constructor signature — it may require specific fields. Alternatively, create a plain object that passes `APICallError.isInstance()` check.

#### Test Block: "processMessage — provider classified error"

| #   | Test Name                                                            | Setup                                                                                                   | Expected Behavior                                                                  | Assertion Pattern                             |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------- |
| 4   | `KaneoClassifiedError` → user-friendly message from `getUserMessage` | Mock `generateText` to throw `new KaneoClassifiedError('msg', providerError.taskNotFound('T-1'))`       | `reply.text` called with message containing `'T-1'` and `'not found'`              | `textCalls[0]` matches expected error message |
| 5   | `ProviderClassifiedError` → routes through `error.error`             | Mock `generateText` to throw `new ProviderClassifiedError('msg', providerError.projectNotFound('P-1'))` | `reply.text` called with message containing `'P-1'` and `'not found'`              | `textCalls[0]` matches expected               |
| 6   | Unknown `Error` → generic message                                    | Mock `generateText` to throw `new Error('random crash')`                                                | `reply.text` called with `'An unexpected error occurred. Please try again later.'` | Exact string match                            |

#### Test Block: "processMessage — history rollback on error"

| #   | Test Name                                          | Setup                                                                                                | Expected Behavior                                                                                    | Assertion Pattern                                                                       |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 7   | On error → history is rolled back to `baseHistory` | Mock `getCachedHistory` to return `[{ role: 'user', content: 'old' }]`; mock `generateText` to throw | `saveHistory` called with `contextId` and the original base history (excluding the new user message) | `expect(saveHistory).toHaveBeenCalledWith('ctx-1', [{ role: 'user', content: 'old' }])` |

**Kill-detection:** If `saveHistory(contextId, baseHistory)` is removed from the catch block, test 7 fails. This is critical — without rollback, a failed message permanently pollutes the conversation history.

#### Test Block: "processMessage — success path history"

| #   | Test Name                                                | Setup                                                                                                            | Expected Behavior                                                        | Assertion Pattern                                                                              |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| 8   | On success → history is extended with assistant messages | Mock `generateText` to return `{ text: 'Hi!', response: { messages: [{ role: 'assistant', content: 'Hi!' }] } }` | `appendHistory` called with `contextId` and the assistant messages array | `expect(appendHistory).toHaveBeenCalledWith('ctx-1', [{ role: 'assistant', content: 'Hi!' }])` |

**Kill-detection:** If `appendHistory` call is removed, test 8 fails. The conversation would lose all assistant responses.

### Module Mocking Blueprint

This task requires extensive mocking. Here is the recommended mock setup, structured for clarity:

```
// ---- Module mocks (before imports) ----

mockLogger()

// Config: return valid config for all keys by default
let configOverrides: Record<string, string | null> = {}
void mock.module('../../src/config.js', () => ({
  getConfig: (_ctxId: string, key: string): string | null => {
    if (key in configOverrides) return configOverrides[key]
    const defaults: Record<string, string> = {
      llm_apikey: 'test-key',
      llm_baseurl: 'http://localhost:11434',
      main_model: 'test-model',
      kaneo_apikey: 'test-kaneo-key',
      timezone: 'UTC',
    }
    return defaults[key] ?? null
  },
}))

// Cache: empty history by default
let cachedHistory: ModelMessage[] = []
void mock.module('../../src/cache.js', () => ({
  getCachedHistory: () => [...cachedHistory],
  getCachedTools: () => null,
  setCachedTools: () => {},
}))

// History: spy on mutations
const appendHistoryCalls: Array<...> = []
const saveHistoryCalls: Array<...> = []
void mock.module('../../src/history.js', () => ({
  appendHistory: (ctxId, msgs) => { appendHistoryCalls.push({ ctxId, msgs }) },
  saveHistory: (ctxId, msgs) => { saveHistoryCalls.push({ ctxId, msgs }) },
  loadHistory: () => [],
}))

// Conversation: passthrough
void mock.module('../../src/conversation.js', () => ({
  buildMessagesWithMemory: (_ctxId, history) => ({ messages: history, memoryMsg: null }),
  shouldTriggerTrim: () => false,
  runTrimInBackground: () => {},
}))

// Memory: no-op
void mock.module('../../src/memory.js', () => ({
  extractFactsFromSdkResults: () => [],
  upsertFact: () => {},
}))

// Provider registry
void mock.module('../../src/providers/registry.js', () => ({
  createProvider: () => mockProvider,
}))

// Tools: empty
void mock.module('../../src/tools/index.js', () => ({
  makeTools: () => ({}),
}))

// Users
void mock.module('../../src/users.js', () => ({
  getKaneoWorkspace: () => 'workspace-1',
}))

// Kaneo provisioning
void mock.module('../../src/providers/kaneo/provision.js', () => ({
  provisionAndConfigure: () => Promise.resolve({ status: 'already_configured' }),
}))

// AI SDK: the key control point
let generateTextImpl: () => Promise<unknown>
void mock.module('ai', () => ({
  generateText: (...args) => generateTextImpl(),
  stepCountIs: () => () => false,
}))
```

### Risks & Mitigations

| Risk                                                                                           | Probability | Impact | Mitigation                                                                                                     |
| ---------------------------------------------------------------------------------------------- | :---------: | :----: | -------------------------------------------------------------------------------------------------------------- |
| Extensive mocking makes tests fragile to import changes                                        |    High     | Medium | Organize mocks into a shared setup block; each test only overrides what it needs                               |
| `processMessage` imports may change as features are added                                      |   Medium    | Medium | Mock at the highest feasible level (module mocks); test behavior not implementation                            |
| `APICallError` constructor requires specific shape                                             |   Medium    |  Low   | Inspect `@ai-sdk/provider` source or use `Object.assign(new Error(...), { isAPICallError: true })` pattern     |
| `generateText` mock needs to match Vercel AI SDK return shape                                  |   Medium    | Medium | Use minimal shape: `{ text: '...', toolCalls: [], toolResults: [], response: { messages: [...] }, usage: {} }` |
| `mock.module` order matters — all mocks must be registered before `import` of `processMessage` |    High     |  High  | Follow existing pattern: all `void mock.module(...)` before `import { processMessage }`                        |

### Acceptance Criteria

- [ ] ≥6 tests covering: missing config, API error, classified errors (Kaneo, Provider, unknown), history rollback, success path
- [ ] Each error type from `handleMessageError` has at least one test verifying the correct reply text
- [ ] History rollback test (test 7) verifies `saveHistory` called with original `baseHistory`
- [ ] Success path test (test 8) verifies `appendHistory` called with assistant messages
- [ ] Reply mock captures text for assertion (using `createMockReply()`)
- [ ] `bun test tests/llm-orchestrator-process.test.ts` passes (new file, separate from `llm-orchestrator-errors.test.ts`)
- [ ] No lint suppressions

---

## Task 2.4 — Add Untested Exported Function Tests

### Problem Analysis

Three groups of exported functions have zero test coverage:

1. **`allOccurrencesBetween`** in [src/cron.ts](../../src/cron.ts) — Used by `createMissedTasks` to find missed cron dates. A bug here causes either too many or too few retroactive tasks.

2. **`appendHistory`** in [src/history.ts](../../src/history.ts) — Used by `processMessage` on every message. A bug here causes conversation history loss or corruption.

3. **`getKaneoWorkspace` / `setKaneoWorkspace`** in [src/users.ts](../../src/users.ts) — Used by `buildProvider` and `processMessage`. A bug here causes provider build failure for all Kaneo users.

### 2.4.1 — `allOccurrencesBetween` Tests

#### Source Code

```typescript
export const allOccurrencesBetween = (
  cron: ParsedCron,
  after: Date,
  before: Date,
  maxResults = 100,
  timezone = 'UTC',
): Date[] => {
  const results: Date[] = []
  let cursor = after
  while (results.length < maxResults) {
    const next = nextCronOccurrence(cron, cursor, timezone)
    if (next === null || next.getTime() > before.getTime()) break
    results.push(next)
    cursor = next
  }
  return results
}
```

Key behaviors:

- `after` is **exclusive** (first result is the next occurrence after `after`)
- `before` is **inclusive** (occurrences at exactly `before` are included)
- `maxResults` caps output (default 100)
- Returns empty array when no occurrences fall in range

#### Test Location

Add to existing `tests/cron.test.ts` in a new `describe('allOccurrencesBetween', ...)` block.

#### Detailed Test Specifications

| #   | Test Name                                          | Setup                                                                                                                   | Expected                                                                                                                | Assertion                                                |
| --- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | "returns all occurrences between two dates"        | Cron: `0 9 * * 1` (Mondays 9am), after: `2026-03-01`, before: `2026-03-31`                                              | 4 dates: Mar 2, 9, 16, 23 (all Mondays at 09:00 UTC)                                                                    | `toHaveLength(4)`, verify each date is a Monday at 09:00 |
| 2   | "returns empty array when no occurrences in range" | Cron: `0 9 * * 1` (Mondays), after: `2026-03-23T09:00:00Z`, before: `2026-03-23T23:59:00Z`                              | Empty array (next Monday is Mar 30, outside range)                                                                      | `toEqual([])`                                            |
| 3   | "after is exclusive"                               | Cron: `0 9 * * *` (daily 9am), after: `2026-03-15T09:00:00Z` (exactly at an occurrence), before: `2026-03-17T09:00:00Z` | 2 dates: Mar 16 09:00 and Mar 17 09:00 (NOT Mar 15 — after is exclusive)                                                | `toHaveLength(2)`, first date is Mar 16                  |
| 4   | "before is inclusive"                              | Cron: `0 9 * * *`, after: `2026-03-14T09:00:00Z`, before: `2026-03-15T09:00:00Z`                                        | 1 date: Mar 15 at 09:00 (exactly at `before`)                                                                           | `toHaveLength(1)`, date equals `before`                  |
| 5   | "respects maxResults cap"                          | Cron: `* * * * *` (every minute), after: `2026-03-15T00:00:00Z`, before: `2026-03-16T00:00:00Z`, maxResults: 5          | 5 dates (not 1440)                                                                                                      | `toHaveLength(5)`                                        |
| 6   | "start equals end → empty"                         | Cron: `0 9 * * *`, after: `2026-03-15T09:00:00Z`, before: `2026-03-15T09:00:00Z`                                        | Empty array (after is exclusive, so the occurrence AT `after` is excluded, and `before` equals `after` so nothing fits) | `toEqual([])`                                            |

**Kill-detection:**

- If `next.getTime() > before.getTime()` is changed to `>=`, test 4 fails (before should be inclusive).
- If `cursor = next` is removed (infinite loop guard), test would hang — but tests have timeouts.
- If `maxResults` check is removed, test 5 fails (or takes very long).

### 2.4.2 — `appendHistory` Tests

#### Source Code

```typescript
export function appendHistory(userId: string, messages: readonly ModelMessage[]): void {
  appendToCachedHistory(userId, messages)
}
```

This delegates to `appendToCachedHistory` in `cache.ts`, which mutates the user's cached history array:

```typescript
export function appendToCachedHistory(userId: string, messages: readonly ModelMessage[]): void {
  const cache = getOrCreateCache(userId)
  cache.history.push(...messages)
  cache.lastAccessed = Date.now()
  syncHistoryToDb(userId, cache.history)
}
```

#### Test Location

Add to existing `tests/history.test.ts` in a new `describe('appendHistory', ...)` block.

#### Detailed Test Specifications

| #   | Test Name                                         | Setup                                                                            | Expected                                                               | Assertion                                 |
| --- | ------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------- |
| 1   | "appends messages to empty history"               | No prior history for user                                                        | After append: `getCachedHistory(userId)` returns the appended messages | `toHaveLength(1)`, `toEqual` on content   |
| 2   | "appends to existing history"                     | `saveHistory` with 2 messages first, then `appendHistory` with 1 more            | `getCachedHistory` returns 3 messages in order                         | `toHaveLength(3)`, verify order preserved |
| 3   | "preserves message types (user, assistant, tool)" | Append a mix of `role: 'user'`, `role: 'assistant'`, and `role: 'tool'` messages | All 3 messages present with correct roles                              | Verify each message's `role` field        |

**Implementation note:** `appendHistory` needs the same mock setup as the existing `history.test.ts` — mock `drizzle.js` and `db/index.js` modules. The existing `beforeEach` already does this.

**Kill-detection:** If `appendHistory` is replaced with a no-op, tests 1–3 fail (cached history unchanged).

### 2.4.3 — `getKaneoWorkspace` / `setKaneoWorkspace` Tests

#### Source Code

```typescript
export function getKaneoWorkspace(userId: string): string | null {
  return getCachedWorkspace(userId)
}

export function setKaneoWorkspace(userId: string, workspaceId: string): void {
  setCachedWorkspace(userId, workspaceId)
}
```

These delegate to `getCachedWorkspace`/`setCachedWorkspace` in `cache.ts`:

```typescript
export function getCachedWorkspace(userId: string): string | null {
  const cache = getOrCreateCache(userId)
  if (cache.workspaceId !== null) return cache.workspaceId
  // Fall through to DB lookup on cache miss
  const db = getDrizzleDb()
  const row = db.select({ workspaceId: users.workspaceId }).from(users).where(...).get()
  cache.workspaceId = row?.workspaceId ?? null
  return cache.workspaceId
}
```

#### Test Location

Add to existing `tests/users.test.ts` in a new `describe('getKaneoWorkspace / setKaneoWorkspace', ...)` block.

#### Detailed Test Specifications

| #   | Test Name                                                      | Setup                                            | Expected                                         | Assertion                                |
| --- | -------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------ | ---------------------------------------- |
| 1   | "returns null when no workspace is set"                        | Fresh user, no workspace configured              | `getKaneoWorkspace('user-1')` returns `null`     | `toBeNull()`                             |
| 2   | "set then get returns workspace ID"                            | `setKaneoWorkspace('user-1', 'ws-abc')`          | `getKaneoWorkspace('user-1')` returns `'ws-abc'` | `toBe('ws-abc')`                         |
| 3   | "overwrites previous workspace"                                | Set to `'ws-1'`, then set to `'ws-2'`            | Get returns `'ws-2'`                             | `toBe('ws-2')`                           |
| 4   | "user isolation — different users have independent workspaces" | Set `user-1` → `'ws-A'`, set `user-2` → `'ws-B'` | Get `user-1` → `'ws-A'`, get `user-2` → `'ws-B'` | Each `toBe` matches respective workspace |

**Implementation note:** The existing `users.test.ts` already mocks `drizzle.js` and uses `setupTestDb()`. The workspace functions use the cache layer, which also needs the DB mock for fallthrough. Ensure the cache is cleared between tests (or use fresh user IDs per test).

**Kill-detection:** If `setKaneoWorkspace` is replaced with a no-op, tests 2–4 fail. If `getKaneoWorkspace` always returns `null`, tests 2–4 fail.

### Risks & Mitigations

| Risk                                                      | Probability | Impact | Mitigation                                                                                 |
| --------------------------------------------------------- | :---------: | :----: | ------------------------------------------------------------------------------------------ |
| `appendHistory` depends on cache module internals         |     Low     |  Low   | Test through public API (`appendHistory` + `getCachedHistory`), don't test cache internals |
| `getKaneoWorkspace` DB fallthrough may need real DB setup |   Medium    |  Low   | Use existing `setupTestDb()` pattern already in `users.test.ts`                            |
| `allOccurrencesBetween` timezone handling with DST        |     Low     |  Low   | All tests use UTC; DST tests deferred to Phase 4 (Task 4.4.6)                              |
| Cache state bleeding between tests                        |   Medium    | Medium | Use distinct user IDs per test or clear cache in `beforeEach`                              |

### Acceptance Criteria

- [ ] `allOccurrencesBetween` has ≥6 tests in `tests/cron.test.ts`
- [ ] `appendHistory` has ≥3 tests in `tests/history.test.ts`
- [ ] `getKaneoWorkspace` / `setKaneoWorkspace` has ≥4 tests in `tests/users.test.ts`
- [ ] All boundary conditions documented: exclusive `after`, inclusive `before`, empty range, maxResults cap
- [ ] User isolation test proves workspace values don't leak between users
- [ ] `bun test tests/cron.test.ts tests/history.test.ts tests/users.test.ts` passes
- [ ] No lint suppressions

---

## Implementation Order & Dependencies

```
Task 2.4 (untested exports) ─────────────────► Done (standalone, simplest)
Task 2.2 (completionHook integration) ──────► Done (standalone, uses existing mocks)
Task 2.1 (scheduler expansion) ─────────────► Done (standalone, most complex)
Task 2.3 (processMessage errors) ───────────► Done (most mocking, most complex)
```

**Recommended execution order:** 2.4 → 2.2 → 2.1 → 2.3 (simplest to most complex, building confidence)

- Tasks 2.4 and 2.2 can be parallelized (no shared files modified)
- Task 2.1 and 2.3 should be done sequentially (both involve heavy module mocking; doing one first builds understanding for the other)
- Task 2.3 requires a new test file (`tests/llm-orchestrator-process.test.ts`)

---

## Files Modified / Created

| Action       | File                                     | Task  |
| ------------ | ---------------------------------------- | ----- |
| **Modified** | `tests/scheduler.test.ts`                | 2.1   |
| **Modified** | `tests/tools/task-tools.test.ts`         | 2.2   |
| **Created**  | `tests/llm-orchestrator-process.test.ts` | 2.3   |
| **Modified** | `tests/cron.test.ts`                     | 2.4.1 |
| **Modified** | `tests/history.test.ts`                  | 2.4.2 |
| **Modified** | `tests/users.test.ts`                    | 2.4.3 |

---

## Validation Protocol

After all 4 tasks are complete:

### Step 1: Full Test Suite Green

```bash
bun test
```

All tests pass, no regressions.

### Step 2: No-Op Mutation Check (Manual)

For each area, temporarily replace the function-under-test with a no-op and verify at least one test fails:

| File                               | Function to No-Op                                       | Expected Failures                            |
| ---------------------------------- | ------------------------------------------------------- | -------------------------------------------- |
| `scheduler.test.ts`                | `executeRecurringTask` → empty function                 | Tests 2–4 (no provider call, no DB update)   |
| `scheduler.test.ts`                | `createMissedTasks` → return 0                          | Tests 12–13 (wrong count, no provider calls) |
| `task-tools.test.ts`               | Remove `completionHook` call from `execute`             | Test 1 (hook not called)                     |
| `llm-orchestrator-process.test.ts` | `handleMessageError` → empty function                   | Tests 3–6 (no reply text)                    |
| `llm-orchestrator-process.test.ts` | Remove `saveHistory(contextId, baseHistory)` from catch | Test 7 (history not rolled back)             |
| `cron.test.ts`                     | `allOccurrencesBetween` → return []                     | Tests 1, 3, 4, 5 (empty results)             |
| `history.test.ts`                  | `appendHistory` → no-op                                 | Tests 1–3 (history unchanged)                |
| `users.test.ts`                    | `setKaneoWorkspace` → no-op                             | Tests 2–4 (get returns null)                 |

### Step 3: Lint Clean

```bash
bun lint
```

Zero `eslint-disable`, `@ts-ignore`, or `@ts-nocheck` in modified or created files.

### Step 4: Mutation Testing (Automated)

```bash
stryker run --mutate src/scheduler.ts
```

Target: ≥50% mutation score for `scheduler.ts`.

```bash
stryker run --mutate src/tools/update-task.ts
```

Target: ≥80% mutation score for `completionHook` invocation path.

---

## Phase 2 Definition of Done

- [ ] `scheduler.test.ts` has ≥14 tests covering tick, error resilience, missed tasks, labels, notifications, start/stop
- [ ] `completionHook` integration: 4 tests in `task-tools.test.ts` verifying hook invocation, error propagation, and when-not-called behavior
- [ ] `processMessage` error routing: ≥6 tests in new `llm-orchestrator-process.test.ts` covering missing config, API errors, classified errors, history rollback, success path
- [ ] All 3 groups of exported functions have tests: `allOccurrencesBetween` (6), `appendHistory` (3), `getKaneoWorkspace`/`setKaneoWorkspace` (4)
- [ ] `bun test` green (full suite, no regressions)
- [ ] No `eslint-disable`, `@ts-ignore`, or `@ts-nocheck` in any modified or created file
- [ ] Mutation testing targets met: scheduler ≥50%, completionHook ≥80%

---

## Appendix A: Source File Quick Reference

| Source File                                                        | Key Exports                                                    | Test File                                      |
| ------------------------------------------------------------------ | -------------------------------------------------------------- | ---------------------------------------------- |
| [src/scheduler.ts](../../src/scheduler.ts)                         | `tick`, `createMissedTasks`, `startScheduler`, `stopScheduler` | `tests/scheduler.test.ts`                      |
| [src/tools/update-task.ts](../../src/tools/update-task.ts)         | `makeUpdateTaskTool`                                           | `tests/tools/task-tools.test.ts`               |
| [src/tools/completion-hook.ts](../../src/tools/completion-hook.ts) | `completionHook`, `CompletionHookFn`                           | `tests/tools/completion-hook.test.ts`          |
| [src/llm-orchestrator.ts](../../src/llm-orchestrator.ts)           | `processMessage`                                               | `tests/llm-orchestrator-process.test.ts` (new) |
| [src/cron.ts](../../src/cron.ts)                                   | `allOccurrencesBetween`, `parseCron`, `nextCronOccurrence`     | `tests/cron.test.ts`                           |
| [src/history.ts](../../src/history.ts)                             | `appendHistory`, `loadHistory`, `saveHistory`, `clearHistory`  | `tests/history.test.ts`                        |
| [src/users.ts](../../src/users.ts)                                 | `getKaneoWorkspace`, `setKaneoWorkspace`                       | `tests/users.test.ts`                          |
| [src/errors.ts](../../src/errors.ts)                               | `getUserMessage`, `isAppError`, `providerError`, `systemError` | `tests/llm-orchestrator-errors.test.ts`        |
| [src/chat/types.ts](../../src/chat/types.ts)                       | `ReplyFn`, `ChatProvider`, `AuthorizationResult`               | (type definitions)                             |

## Appendix B: Test Helper Reference

| Helper                                | Location                       | Purpose                                                  |
| ------------------------------------- | ------------------------------ | -------------------------------------------------------- |
| `setupTestDb()`                       | `tests/utils/test-helpers.ts`  | Creates in-memory SQLite DB with all migrations          |
| `mockLogger()`                        | `tests/utils/test-helpers.ts`  | Stubs `src/logger.ts` exports                            |
| `createMockReply()`                   | `tests/utils/test-helpers.ts`  | Creates mock `ReplyFn` that captures text calls          |
| `createMockProvider(overrides)`       | `tests/tools/mock-provider.ts` | Creates mock `TaskProvider` with all methods stubbed     |
| `schemaValidates(tool, data)`         | `tests/test-helpers.ts`        | Tests if a tool's `inputSchema.safeParse(data)` succeeds |
| `getToolExecutor(tool)`               | `tests/test-helpers.ts`        | Extracts `execute` function from a tool for testing      |
| `clearUserCache(userId)`              | `tests/utils/test-cache.ts`    | Clears all cached state for a user                       |
| `setCachedConfig(userId, key, value)` | `src/cache.ts`                 | Seeds config value into cache for test user              |

## Appendix C: Cross-Phase Dependencies

| Phase 2 Task         | Builds On (Phase 1)                                 | Enables (Future Phases)                                                                                              |
| -------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 2.1 (scheduler)      | None                                                | Phase 6, Task 6.3.1 (add `src/scheduler.ts` for StrykerJS once coverage is sufficient)                               |
| 2.2 (completionHook) | None                                                | Phase 4, Task 4.2.5 (`on_complete` + `cronExpression` conflict)                                                      |
| 2.3 (processMessage) | Phase 1, Task 1.1 (bot-auth must be reliable first) | Phase 4, Task 4.4 (conversation edge cases)                                                                          |
| 2.4 (exports)        | None                                                | Phase 4, Task 4.4.1 (cron boundary cases), Phase 6, Task 6.3 (StrykerJS scope expansion for `cron.ts`, `history.ts`) |
