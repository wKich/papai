# Phase 1: Fix False-Confidence Tests — Detailed Test Plan

**Date:** 2026-03-22
**Status:** Draft
**Parent:** [Test Improvement Roadmap](2026-03-22-test-improvement-roadmap.md)
**Goal:** Every test in these 5 files should fail when the function under test is broken

---

## Executive Summary

Phase 1 targets 5 test files (score ≤ 4/10) that currently pass **even when the code they claim to test is replaced with a no-op**. These are the highest-priority fixes because they create false confidence — the test suite reports green while bugs lurk silently.

| File                                 | Current Score | Root Cause                                                                     | Tests Today |  Tests After  |
| ------------------------------------ | :-----------: | ------------------------------------------------------------------------------ | :---------: | :-----------: |
| `tests/bot-auth.test.ts`             |     1/10      | Tests check DB row presence, never call `checkAuthorizationExtended`           |      8      |     10–12     |
| `tests/tools/comment-tools.test.ts`  |     4/10      | `removeComment`/`updateComment` use wrong parameter names                      |     ~18     |      ~22      |
| `tests/e2e/label-operations.test.ts` |     5/10      | Vacuous `expect(true).toBe(true)`                                              |      5      |   5 (fixed)   |
| `tests/logger.test.ts`               |     1/10      | Tests a fresh `pino()` instance, not the project's `logger` or `getLogLevel()` |      3      |      6–8      |
| `tests/bot.test.ts`                  |     2/10      | Tests `formatLlmOutput` from `format.ts`, not `bot.ts`                         |      2      | 0 (relocated) |

---

## Task 1.1 — Rewrite `tests/bot-auth.test.ts`

### Problem Analysis

The existing test file has 8 tests across 4 `describe` blocks. Every test follows the same broken pattern:

1. Insert a row into the DB (`addUser` or `addGroupMember`)
2. Query the DB to verify the row exists
3. Never call `checkAuthorizationExtended`

This means the tests verify that `addUser` and `addGroupMember` work (which is already tested in `users.test.ts` and `groups.test.ts`), not that authorization logic is correct. If `checkAuthorizationExtended` were deleted entirely, all 8 tests would still pass.

### Source Code Under Test

[src/bot.ts](../../src/bot.ts) exports `checkAuthorizationExtended` with this signature:

```typescript
checkAuthorizationExtended(
  userId: string,
  username: string | null,
  contextId: string,
  contextType: ContextType,   // 'dm' | 'group'
  isPlatformAdmin: boolean,
): AuthorizationResult
```

Where `AuthorizationResult` is:

```typescript
{
  allowed: boolean
  isBotAdmin: boolean
  isGroupAdmin: boolean
  storageContextId: string
}
```

The function delegates to:

- `isAuthorized(userId)` — checks `users` table for `platformUserId` match
- `isGroupMember(contextId, userId)` — checks `group_members` table
- `resolveUserByUsername(userId, username)` — checks `users` table by `username`, updates `platformUserId` if needed

All three read from the drizzle DB, meaning the existing `setupTestDb` + `mockDrizzle` pattern is appropriate.

### Existing Infrastructure to Reuse

- `setupTestDb()` from `tests/utils/test-helpers.ts` — creates in-memory SQLite with full migrations
- `mockLogger()` from `tests/utils/test-helpers.ts` — stubs logger to suppress output
- `addUser(platformUserId, addedBy, username)` from `src/users.ts` — inserts into `users` table
- `addGroupMember(groupId, userId, addedBy)` from `src/groups.ts` — inserts into `group_members` table

### Detailed Test Specifications

#### Setup (file-level)

```
mockLogger()                         // before any src imports
mock.module('../src/db/drizzle.js')  // redirect getDrizzleDb to test DB
import { checkAuthorizationExtended } from '../src/bot.js'
import { addUser } from '../src/users.js'
import { addGroupMember } from '../src/groups.js'

beforeEach: testDb = await setupTestDb()
```

#### Test Block: "Bot Admin Authorization"

| #   | Test Name                                                              | Setup                                   | Call                                                                        | Expected Result                                                                         | Assertion Pattern        |
| --- | ---------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------ |
| 1   | Bot admin in DM → allowed with isBotAdmin, storageContextId=userId     | `addUser('admin-1', 'system', 'admin')` | `checkAuthorizationExtended('admin-1', 'admin', 'admin-1', 'dm', false)`    | `{ allowed: true, isBotAdmin: true, isGroupAdmin: false, storageContextId: 'admin-1' }` | `toEqual` on full result |
| 2   | Bot admin in group → allowed with isBotAdmin, storageContextId=groupId | `addUser('admin-1', 'system', 'admin')` | `checkAuthorizationExtended('admin-1', 'admin', 'group-1', 'group', false)` | `{ allowed: true, isBotAdmin: true, isGroupAdmin: false, storageContextId: 'group-1' }` | `toEqual` on full result |
| 3   | Bot admin who is also platform admin → isGroupAdmin=true               | `addUser('admin-1', 'system', 'admin')` | `checkAuthorizationExtended('admin-1', 'admin', 'group-1', 'group', true)`  | `{ allowed: true, isBotAdmin: true, isGroupAdmin: true, storageContextId: 'group-1' }`  | `toEqual` on full result |

**Kill-detection:** If `isAuthorized` is mutated to always return `false`, tests 1–3 fail because `isBotAdmin` would become `false`.

#### Test Block: "Group Member Authorization"

| #   | Test Name                                                       | Setup                                             | Call                                                                        | Expected Result                                                                           | Assertion Pattern        |
| --- | --------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------ |
| 4   | Group member → allowed, not bot admin, storageContextId=groupId | `addGroupMember('group-1', 'member-1', 'system')` | `checkAuthorizationExtended('member-1', null, 'group-1', 'group', false)`   | `{ allowed: true, isBotAdmin: false, isGroupAdmin: false, storageContextId: 'group-1' }`  | `toEqual` on full result |
| 5   | Group member who is platform admin → isGroupAdmin=true          | `addGroupMember('group-1', 'member-1', 'system')` | `checkAuthorizationExtended('member-1', null, 'group-1', 'group', true)`    | `{ allowed: true, isBotAdmin: false, isGroupAdmin: true, storageContextId: 'group-1' }`   | `toEqual` on full result |
| 6   | Non-member in group → not allowed                               | (no setup)                                        | `checkAuthorizationExtended('stranger-1', null, 'group-1', 'group', false)` | `{ allowed: false, isBotAdmin: false, isGroupAdmin: false, storageContextId: 'group-1' }` | `toEqual` on full result |

**Kill-detection:** If `isGroupMember` is mutated to always return `true`, test 6 fails.

#### Test Block: "DM User Resolution by Username"

| #   | Test Name                                                       | Setup                                          | Call                                                                                 | Expected Result                                                                               | Assertion Pattern        |
| --- | --------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------ |
| 7   | DM user resolved by username → allowed, storageContextId=userId | `addUser('placeholder-id', 'system', 'alice')` | `checkAuthorizationExtended('real-alice-id', 'alice', 'real-alice-id', 'dm', false)` | `{ allowed: true, isBotAdmin: true, isGroupAdmin: false, storageContextId: 'real-alice-id' }` | `toEqual` on full result |
| 8   | DM user with unmatched username → not allowed                   | (no setup)                                     | `checkAuthorizationExtended('unknown-id', 'bob', 'unknown-id', 'dm', false)`         | `{ allowed: false, isBotAdmin: false, isGroupAdmin: false, storageContextId: 'unknown-id' }`  | `toEqual` on full result |

**Kill-detection:** If `resolveUserByUsername` is mutated to always return `false`, test 7 fails.

#### Test Block: "Priority: Bot Admin Wins Over Group Check"

| #   | Test Name                                                                                | Setup                                                                                      | Call                                                                        | Expected Result                                                                         | Assertion Pattern                                                           |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 9   | User who is BOTH bot admin AND group member → returns bot admin result (isBotAdmin=true) | `addUser('admin-1', 'system', 'admin')` + `addGroupMember('group-1', 'admin-1', 'system')` | `checkAuthorizationExtended('admin-1', 'admin', 'group-1', 'group', false)` | `{ allowed: true, isBotAdmin: true, isGroupAdmin: false, storageContextId: 'group-1' }` | `toEqual` — key: `isBotAdmin === true` proves bot admin path executed first |

**Kill-detection:** If the `isAuthorized` check is moved below the `isGroupMember` check, this test catches it because `isBotAdmin` would become `false`.

#### Test Block: "Message Handler Authorization Integration" (Optional, higher complexity)

These tests verify the `chat.onMessage` handler in `setupBot` uses `checkAuthorizationExtended` correctly. They require mocking the `ChatProvider` interface. Consider deferring to Phase 2 (Task 2.3) if scope is too large.

| #   | Test Name                                                                        | Key Assertion                                               |
| --- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 10  | Unauthorized user with `isMentioned=true` → reply includes "not authorized" text | `reply.text` called with string containing `/group adduser` |
| 11  | Unauthorized user with `isMentioned=false` → no reply, no `processMessage` call  | `reply.text` NOT called, `processMessage` NOT called        |
| 12  | Natural language in group without mention → silently ignored                     | `processMessage` NOT called                                 |

### Risks & Mitigations

| Risk                                                                                   | Probability | Impact | Mitigation                                                                                                                 |
| -------------------------------------------------------------------------------------- | :---------: | :----: | -------------------------------------------------------------------------------------------------------------------------- |
| `mock.module` for drizzle must execute before `import bot.ts`                          |   Medium    |  High  | Follow existing pattern: `mockLogger()` + `mock.module(drizzle)` before `import`                                           |
| `bot.ts` imports grammy-related modules via `commands/index.js`                        |   Medium    |  High  | Mock `./commands/index.js` to export no-ops, or import `checkAuthorizationExtended` directly (it's independently exported) |
| `checkAuthorizationExtended` is a pure function of DB state — no side effects to break |     Low     |  Low   | Direct function call testing is sufficient; no need for HTTP mocks                                                         |

### Acceptance Criteria

- [ ] Zero tests that pass if `checkAuthorizationExtended` body is replaced with `return { allowed: false, isBotAdmin: false, isGroupAdmin: false, storageContextId: '' }`
- [ ] Every test calls `checkAuthorizationExtended` directly and asserts on `AuthorizationResult` fields using `toEqual`
- [ ] `bun test tests/bot-auth.test.ts` passes
- [ ] No `eslint-disable`, `@ts-ignore`, or `@ts-nocheck`

---

## Task 1.2 — Fix `tests/tools/comment-tools.test.ts`

### Problem Analysis

The test file has ~18 tests that are mostly correct for `addComment` and `getComments`. The bugs are in `updateComment` and `removeComment` sections:

**`makeUpdateCommentTool` tests:** The production code's `inputSchema` requires `{ taskId, activityId, comment }` (3 fields). But the tests call `execute` with only `{ activityId, comment }` — missing `taskId`. The tool still produces a result because the mock provider ignores input and returns a canned response. The `toHaveBeenCalledWith` assertion that would catch this is absent.

Specifically in [src/tools/update-comment.ts](../../src/tools/update-comment.ts):

```typescript
inputSchema: z.object({
  taskId: z.string(),
  activityId: z.string(),
  comment: z.string(),
}),
execute: async ({ taskId, activityId, comment }) => {
  return await provider.updateComment!({ taskId, commentId: activityId, body: comment })
}
```

The test at line ~208 calls:

```typescript
execute({ activityId: 'comment-1', comment: 'Updated comment' }, ...)
```

Missing `taskId` entirely. If the tool used its schema to parse input (which the `ai` SDK does at runtime), this would fail with a Zod validation error.

**`makeRemoveCommentTool` tests:** Same issue. The production code's `inputSchema` requires `{ taskId, commentId }`. The tests pass `{ activityId: 'comment-1' }` — wrong field name AND missing `taskId`.

In [src/tools/remove-comment.ts](../../src/tools/remove-comment.ts):

```typescript
inputSchema: z.object({
  taskId: z.string(),
  commentId: z.string(),
}),
execute: async ({ taskId, commentId }) => {
  return await provider.removeComment!({ taskId, commentId })
}
```

The test at line ~285 calls:

```typescript
execute({ activityId: 'comment-1' }, ...)
```

Both the field name (`activityId` instead of `commentId`) and the missing `taskId` are wrong.

### Detailed Test Fixes

#### Fix 1: `makeUpdateCommentTool` — Add `taskId` to all `execute` calls

| Test Name                            | Current Params                                            | Fixed Params                                                                |
| ------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------------- |
| "updates existing comment"           | `{ activityId: 'comment-1', comment: 'Updated comment' }` | `{ taskId: 'task-1', activityId: 'comment-1', comment: 'Updated comment' }` |
| "propagates comment not found error" | `{ activityId: 'invalid', comment: 'Test' }`              | `{ taskId: 'task-1', activityId: 'invalid', comment: 'Test' }`              |

**New assertion to add** after each `execute` call in the happy-path test:

```typescript
expect(provider.updateComment).toHaveBeenCalledWith({
  taskId: 'task-1',
  commentId: 'comment-1',
  body: 'Updated comment',
})
```

This verifies that the tool correctly maps `activityId` → `commentId` when calling the provider.

#### Fix 2: Schema validation test for `updateComment`

The existing schema validation tests check subsets:

- `{ comment: 'Test' }` → invalid (missing `activityId`) ✓
- `{ activityId: 'comment-1' }` → invalid (missing `comment`) ✓

**Missing test:**

- `{ activityId: 'comment-1', comment: 'Test' }` → invalid (missing `taskId`)
- `{ taskId: 'task-1', activityId: 'comment-1', comment: 'Test' }` → valid

#### Fix 3: `makeRemoveCommentTool` — Fix parameter names and add `taskId`

| Test Name                            | Current Params                | Fixed Params                                   |
| ------------------------------------ | ----------------------------- | ---------------------------------------------- |
| "removes comment successfully"       | `{ activityId: 'comment-1' }` | `{ taskId: 'task-1', commentId: 'comment-1' }` |
| "propagates comment not found error" | `{ activityId: 'invalid' }`   | `{ taskId: 'task-1', commentId: 'invalid' }`   |

**New assertion to add** in the happy-path test:

```typescript
expect(provider.removeComment).toHaveBeenCalledWith({
  taskId: 'task-1',
  commentId: 'comment-1',
})
```

#### Fix 4: Schema validation test for `removeComment`

Current test:

- `{}` → invalid ✓

**Missing tests:**

- `{ taskId: 'task-1' }` → invalid (missing `commentId`)
- `{ commentId: 'comment-1' }` → invalid (missing `taskId`)
- `{ taskId: 'task-1', commentId: 'comment-1' }` → valid

#### Fix 5: `addComment` — Add provider argument verification

The `addComment` tests check the return value but never verify what arguments were forwarded to the provider.

**New assertion in "adds comment to task" test:**

```typescript
expect(provider.addComment).toHaveBeenCalledWith({
  taskId: 'task-1',
  body: 'New comment',
})
```

> **Note:** Verify actual provider call signature from `src/tools/add-comment.ts` before writing — the spread/destructure may differ.

#### Fix 6: Schema-through-execute roundtrip test

Add one test per tool that parses input through the tool's own `inputSchema.parse()` then passes the parsed result to `execute()`. This catches any schema/execute contract mismatches.

```
test('schema parse → execute roundtrip', async () => {
  const parsed = tool.inputSchema.parse({ taskId: 'task-1', commentId: 'c-1' })
  const result = await tool.execute(parsed, { toolCallId: '1', messages: [] })
  expect(result).toBeDefined()
})
```

### New Tests Summary

| #   | Describe Block          | Test Name                                                   | Type                         |
| --- | ----------------------- | ----------------------------------------------------------- | ---------------------------- |
| 1   | `makeUpdateCommentTool` | "forwards taskId and maps activityId→commentId to provider" | New — `toHaveBeenCalledWith` |
| 2   | `makeUpdateCommentTool` | "validates taskId is required"                              | New — schema validation      |
| 3   | `makeUpdateCommentTool` | "accepts valid full input"                                  | New — schema validation      |
| 4   | `makeRemoveCommentTool` | "forwards taskId and commentId to provider"                 | New — `toHaveBeenCalledWith` |
| 5   | `makeRemoveCommentTool` | "validates taskId is required"                              | New — schema validation      |
| 6   | `makeRemoveCommentTool` | "validates commentId is required"                           | New — schema validation      |
| 7   | `makeAddCommentTool`    | "forwards taskId and comment body to provider"              | New — `toHaveBeenCalledWith` |

### Modified Tests Summary

| #   | Test Name                                            | Change                                                                   |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | "updates existing comment"                           | Add `taskId: 'task-1'` to execute params                                 |
| 2   | "propagates comment not found error" (updateComment) | Add `taskId: 'task-1'` to execute params                                 |
| 3   | "removes comment successfully"                       | Change `{ activityId }` → `{ taskId: 'task-1', commentId: 'comment-1' }` |
| 4   | "propagates comment not found error" (removeComment) | Change `{ activityId }` → `{ taskId: 'task-1', commentId: 'invalid' }`   |
| 5   | "validates activityId is required" (removeComment)   | Rename to "validates commentId is required", update data                 |

### Risks & Mitigations

| Risk                                                                            |   Probability    | Impact | Mitigation                                                      |
| ------------------------------------------------------------------------------- | :--------------: | :----: | --------------------------------------------------------------- |
| `execute` is called directly (not via SDK), skipping Zod validation at runtime  |       High       | Medium | Add explicit schema-roundtrip tests (Fix 6) to catch mismatches |
| Provider mock auto-resolves regardless of input — existing tests masked the bug | Already happened |  N/A   | Add `toHaveBeenCalledWith` assertions to every happy-path test  |

### Acceptance Criteria

- [ ] No `execute` call in `updateComment` tests is missing `taskId`
- [ ] No `execute` call in `removeComment` tests uses `activityId` instead of `commentId`
- [ ] Every happy-path test includes `toHaveBeenCalledWith` assertion on the provider mock
- [ ] Schema validation tests cover all required fields for each tool
- [ ] `bun test tests/tools/comment-tools.test.ts` passes
- [ ] No lint suppressions

---

## Task 1.3 — Fix `tests/e2e/label-operations.test.ts`

### Problem Analysis

The file has 5 tests. Four are well-written (create, update, list, remove). The 5th — "adds and removes label from task" — ends with `expect(true).toBe(true)`, which passes regardless of what `addTaskLabel` and `removeTaskLabel` actually do.

The full test flow (lines 89–110):

1. Creates a label
2. Creates a task
3. Calls `addTaskLabel({ config, taskId, labelId, workspaceId })`
4. Calls `removeTaskLabel({ config, taskId, labelId })`
5. `expect(true).toBe(true)` ← **vacuous**

### Available Verification Mechanisms

The Kaneo API's `getTask` does **not** return labels in its response schema (`TaskSchema` has no `labels` field). However, label assignment can be verified indirectly:

- **Option A:** Call `getActivities` for the task and check for label-add/remove activity entries
- **Option B:** Assert that `addTaskLabel` / `removeTaskLabel` return the expected `{ taskId, labelId }` response without throwing
- **Option C:** After `addTaskLabel`, call `listLabels` for the workspace and check label still exists (doesn't verify association but at least proves no crash)

Given the E2E context and the API's limitations, **Option B** is the most practical — verify the return values from each function call.

### Detailed Test Fix

Replace:

```typescript
await addTaskLabel({ config, taskId: task.id, labelId: label.id, workspaceId: ... })
await removeTaskLabel({ config, taskId: task.id, labelId: label.id })
expect(true).toBe(true)
```

With:

```typescript
const addResult = await addTaskLabel({ config, taskId: task.id, labelId: label.id, workspaceId: ... })
expect(addResult).toEqual({ taskId: task.id, labelId: label.id })

const removeResult = await removeTaskLabel({ config, taskId: task.id, labelId: label.id })
expect(removeResult).toEqual({ taskId: task.id, labelId: label.id })
```

This ensures:

1. Both functions complete without throwing
2. Both functions return the expected shape with correct IDs
3. If `addTaskLabel` silently no-ops (returns wrong IDs or empty), the test fails

### Acceptance Criteria

- [ ] Zero `expect(true).toBe(true)` in the file
- [ ] `addTaskLabel` return value is asserted with matching `taskId` and `labelId`
- [ ] `removeTaskLabel` return value is asserted with matching `taskId` and `labelId`
- [ ] `bun test tests/e2e/label-operations.test.ts` passes (requires running Kaneo instance)

---

## Task 1.4 — Rewrite `tests/logger.test.ts`

### Problem Analysis

The existing file creates its own `pino()` instance:

```typescript
import pino from 'pino'
const logger = pino({ level: 'info', ... })
```

Then tests that this fresh instance has `.trace`, `.debug`, `.info`, `.warn`, `.error`, `.fatal` methods. This tests **pino** itself, not the project's logger.

The actual project logger in [src/logger.ts](../../src/logger.ts) has meaningful logic worth testing:

```typescript
const getLogLevel = (): string => {
  const envLevel = process.env['LOG_LEVEL']?.toLowerCase()
  const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']
  if (envLevel !== undefined && envLevel !== '' && validLevels.includes(envLevel)) {
    return envLevel
  }
  return 'info'
}

export const logger = pino({ level: getLogLevel(), ... })
```

`getLogLevel()` is not exported, but its behavior is observable through the exported `logger.level` property, or by testing it explicitly after extracting it (if an export is added) or by testing indirectly through environment variables.

### Approach

Since `getLogLevel` is a private function, the cleanest approach is:

1. **Test the exported `logger`'s `level` property** under different `process.env['LOG_LEVEL']` values
2. This requires **re-importing** the module after changing the env var, since `getLogLevel()` runs at import time

**Bun's `mock.module` with `import()` re-evaluation** — or — saving/restoring env vars and using a dynamic `import()` for each test with cache-busting.

**Simpler alternative**: Since `getLogLevel()` is a pure function that only reads `process.env`, test it by dynamically importing the module. Each test group sets `process.env['LOG_LEVEL']` before import.

**Recommended approach**: Extract `getLogLevel` as an export (it's already a standalone function with no dependencies). This is a minimal change to the source file (1 word: add `export`) that makes testing drastically simpler. Document this in the ADR.

### Detailed Test Specifications

#### Option A: Test via `getLogLevel()` (requires adding `export` to src/logger.ts)

```typescript
// Single change to src/logger.ts:
// const getLogLevel → export const getLogLevel
```

| #   | Test Name                                 | Setup                                 | Call            | Expected   | Assertion        |
| --- | ----------------------------------------- | ------------------------------------- | --------------- | ---------- | ---------------- |
| 1   | `LOG_LEVEL=debug` → returns 'debug'       | `process.env['LOG_LEVEL'] = 'debug'`  | `getLogLevel()` | `'debug'`  | `toBe('debug')`  |
| 2   | `LOG_LEVEL=DEBUG` → case-insensitive      | `process.env['LOG_LEVEL'] = 'DEBUG'`  | `getLogLevel()` | `'debug'`  | `toBe('debug')`  |
| 3   | `LOG_LEVEL=trace` → returns 'trace'       | `process.env['LOG_LEVEL'] = 'trace'`  | `getLogLevel()` | `'trace'`  | `toBe('trace')`  |
| 4   | `LOG_LEVEL=banana` → falls back to 'info' | `process.env['LOG_LEVEL'] = 'banana'` | `getLogLevel()` | `'info'`   | `toBe('info')`   |
| 5   | `LOG_LEVEL=''` → falls back to 'info'     | `process.env['LOG_LEVEL'] = ''`       | `getLogLevel()` | `'info'`   | `toBe('info')`   |
| 6   | `LOG_LEVEL` unset → falls back to 'info'  | `delete process.env['LOG_LEVEL']`     | `getLogLevel()` | `'info'`   | `toBe('info')`   |
| 7   | `LOG_LEVEL=silent` → returns 'silent'     | `process.env['LOG_LEVEL'] = 'silent'` | `getLogLevel()` | `'silent'` | `toBe('silent')` |
| 8   | `LOG_LEVEL=fatal` → returns 'fatal'       | `process.env['LOG_LEVEL'] = 'fatal'`  | `getLogLevel()` | `'fatal'`  | `toBe('fatal')`  |

#### Test for exported `logger` instance

| #   | Test Name                                         | Assertion                                                                                                   |
| --- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 9   | Exported `logger` uses level from `getLogLevel()` | Import `logger` and assert `logger.level` equals expected value based on current `process.env['LOG_LEVEL']` |

#### Required Source Change

File: `src/logger.ts`

```diff
- const getLogLevel = (): string => {
+ export const getLogLevel = (): string => {
```

This is a minimal, non-breaking change. `getLogLevel` is a pure function with no side effects.

#### Environment Variable Cleanup

Each test must restore `process.env['LOG_LEVEL']` in `afterEach`:

```typescript
let originalLogLevel: string | undefined

beforeEach(() => {
  originalLogLevel = process.env['LOG_LEVEL']
})

afterEach(() => {
  if (originalLogLevel === undefined) {
    delete process.env['LOG_LEVEL']
  } else {
    process.env['LOG_LEVEL'] = originalLogLevel
  }
})
```

### Risks & Mitigations

| Risk                                                                                            | Probability | Impact | Mitigation                                                                                           |
| ----------------------------------------------------------------------------------------------- | :---------: | :----: | ---------------------------------------------------------------------------------------------------- |
| Adding `export` to `getLogLevel` may trigger a lint rule about unused exports                   |     Low     |  Low   | It will be used by the test; knip can be configured to allow test imports                            |
| `logger.level` is set once at module load time; changing env var after import doesn't change it |    High     | Medium | Test `getLogLevel()` directly (tests the logic); add one test for `logger.level` against current env |

### Acceptance Criteria

- [ ] No test creates its own `pino()` instance
- [ ] `getLogLevel()` is tested with ≥6 env-var scenarios
- [ ] Each valid level ('trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent') is tested at least once
- [ ] Invalid values and edge cases (empty string, unset, garbage) fall back to 'info'
- [ ] `process.env['LOG_LEVEL']` is saved and restored in each test
- [ ] `bun test tests/logger.test.ts` passes
- [ ] No lint suppressions

---

## Task 1.5 — Rename and Fix `tests/bot.test.ts`

### Problem Analysis

`tests/bot.test.ts` imports from `src/chat/telegram/format.ts` and tests `formatLlmOutput`. It has nothing to do with `src/bot.ts`:

```typescript
import { formatLlmOutput } from '../src/chat/telegram/format.js'
```

Meanwhile, `tests/utils/format.test.ts` already exists with **comprehensive** coverage of `formatLlmOutput` (27+ tests covering inline formatting, blocks, links, tables, lists, edge cases).

### Comparison

| Aspect     | `tests/bot.test.ts`       | `tests/utils/format.test.ts`                                                                           |
| ---------- | ------------------------- | ------------------------------------------------------------------------------------------------------ |
| Tests      | 2                         | 27+                                                                                                    |
| Coverage   | Bold, plain text          | Bold, italic, strikethrough, code, headers, code blocks, blockquotes, links, tables, lists, edge cases |
| Assertions | Loose (`toHaveLength(1)`) | Exact (`toEqual` on full entities arrays)                                                              |

The 2 tests in `bot.test.ts` are a strict subset of what `format.test.ts` already covers with better assertions.

### Action Plan

| Step | Action                                                                 | Details                                                                                                        |
| ---- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1    | **Check for unique coverage**                                          | Do the 2 tests in `bot.test.ts` cover anything not in `format.test.ts`?                                        |
| 2a   | If no unique coverage: **Delete `tests/bot.test.ts`**                  | It's entirely redundant with `tests/utils/format.test.ts`                                                      |
| 2b   | If unique coverage exists: **Merge into `tests/utils/format.test.ts`** | Move the unique tests, improve their assertions to match the `format.test.ts` style (`toEqual` on full result) |

#### Unique Coverage Analysis

| bot.test.ts Test                                            | Equivalent in format.test.ts?                        |
| ----------------------------------------------------------- | ---------------------------------------------------- |
| `'**bold** text'` → `text='bold text'`, entities has 1 bold | Yes — "bold" test: `'**bold**'` → exact entity match |
| `'plain text'` → `text='plain text'`, 0 entities            | Yes — "plain text produces no entities" test         |

**Conclusion:** Zero unique coverage. `tests/bot.test.ts` should be **deleted**.

#### Additional `formatLlmOutput` tests to add to `tests/utils/format.test.ts`

The roadmap asks for these specific missing scenarios. After investigating `format.test.ts`, here's the gap analysis:

| Requested Scenario                            |    Already in format.test.ts?    | Action                         |
| --------------------------------------------- | :------------------------------: | ------------------------------ |
| Nested markdown (`**_bold italic_**`)         |                No                | Add to inline formatting block |
| Fenced code block without language annotation |                No                | Add to block formatting block  |
| Empty string input                            | Yes ("empty string" test exists) | Skip                           |
| Multi-level headers (h3–h6)                   |     No (only h1, h2 tested)      | Add to block formatting block  |
| CRLF line endings                             |                No                | Add to edge cases block        |

### New Tests to Add to `tests/utils/format.test.ts`

| #   | Describe Block    | Test Name                              | Input                                          | Expected Behavior                                                                   |
| --- | ----------------- | -------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | inline formatting | "nested bold italic"                   | `'***bold italic***'` or `'**_bold italic_**'` | `text='bold italic'`, entities contain both bold and italic                         |
| 2   | block formatting  | "fenced code block without language"   | `'```\nconsole.log("hi")\n```'`                | `text='console.log("hi")'`, entity is `code` or `pre` (without `language` property) |
| 3   | block formatting  | "h3 header becomes bold"               | `'### Section'`                                | `text='Section'`, entity is bold                                                    |
| 4   | block formatting  | "h4 header becomes bold"               | `'#### Subsection'`                            | `text='Subsection'`, entity is bold                                                 |
| 5   | edge cases        | "CRLF line endings treated same as LF" | `'**bold**\r\ntext'`                           | `text` contains no `\r`, bold entity present                                        |

### Risks & Mitigations

| Risk                                                                                             | Probability | Impact | Mitigation                                                       |
| ------------------------------------------------------------------------------------------------ | :---------: | :----: | ---------------------------------------------------------------- |
| Deleting `bot.test.ts` may confuse `bun test` aggregate counts                                   |     Low     |  Low   | Informational — test count will drop by 2, offset by new tests   |
| `markdownToFormattable` from `@gramio/format` may handle nested markup differently than expected |   Medium    |  Low   | Run the test and inspect actual output before writing assertions |

### Acceptance Criteria

- [ ] `tests/bot.test.ts` is deleted
- [ ] No reduction in actual coverage (all scenarios already covered in `tests/utils/format.test.ts`)
- [ ] ≥4 new tests added to `tests/utils/format.test.ts` for the identified gaps
- [ ] `bun test tests/utils/format.test.ts` passes
- [ ] No lint suppressions

---

## Implementation Order & Dependencies

```
Task 1.4 (logger) ──────────────────────────────► Done (standalone, no deps)
Task 1.5 (bot.test rename) ─────────────────────► Done (standalone, no deps)
Task 1.3 (E2E label-operations) ────────────────► Done (standalone, requires Kaneo)
Task 1.2 (comment-tools) ──────────────────────► Done (standalone, no deps)
Task 1.1 (bot-auth) ────────────────────────────► Done (standalone, most complex)
```

**Recommended execution order:** 1.4 → 1.5 → 1.3 → 1.2 → 1.1 (simplest to most complex, building confidence)

Tasks 1.4 and 1.5 can be parallelized. Tasks 1.2 and 1.3 can be parallelized. Task 1.1 is the most complex and should be done last with full attention.

---

## Validation Protocol

After all 5 tasks are complete:

### Step 1: Full Test Suite Green

```bash
bun test
```

All tests pass, no regressions.

### Step 2: No-Op Mutation Check (Manual)

For each file, temporarily replace the function-under-test with a no-op and verify at least one test fails:

| File                       | Function to No-Op                                                                                                               | Expected Failures                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `bot-auth.test.ts`         | `checkAuthorizationExtended` → always return `{ allowed: false, isBotAdmin: false, isGroupAdmin: false, storageContextId: '' }` | All 9+ tests                          |
| `comment-tools.test.ts`    | `provider.updateComment` mock → never called                                                                                    | `toHaveBeenCalledWith` tests          |
| `label-operations.test.ts` | `addTaskLabel` → return `{}`                                                                                                    | Return value assertion                |
| `logger.test.ts`           | `getLogLevel` → always return `'warn'`                                                                                          | Tests expecting 'debug', 'info', etc. |

### Step 3: Lint Clean

```bash
bun lint
```

Zero `eslint-disable`, `@ts-ignore`, or `@ts-nocheck` in modified files.

### Step 4: Mutation Testing (Automated)

```bash
stryker run --mutate src/bot.ts
```

Target: ≥60% mutation score for `checkAuthorizationExtended` function.

---

## Phase 1 Definition of Done

- [ ] Zero tests that pass when the function-under-test is replaced with a no-op
- [ ] `bun test` green (full suite, no regressions)
- [ ] No `eslint-disable`, `@ts-ignore`, or `@ts-nocheck` in any modified file
- [ ] `checkAuthorizationExtended` mutation score ≥ 60%
- [ ] All 5 files scored ≥ 7/10 on re-audit

---

## Appendix A: Source File Quick Reference

| Source File                                                                                | Key Exports                              | Test File                            |
| ------------------------------------------------------------------------------------------ | ---------------------------------------- | ------------------------------------ |
| [src/bot.ts](../../src/bot.ts)                                                             | `checkAuthorizationExtended`, `setupBot` | `tests/bot-auth.test.ts`             |
| [src/tools/update-comment.ts](../../src/tools/update-comment.ts)                           | `makeUpdateCommentTool`                  | `tests/tools/comment-tools.test.ts`  |
| [src/tools/remove-comment.ts](../../src/tools/remove-comment.ts)                           | `makeRemoveCommentTool`                  | `tests/tools/comment-tools.test.ts`  |
| [src/tools/add-comment.ts](../../src/tools/add-comment.ts)                                 | `makeAddCommentTool`                     | `tests/tools/comment-tools.test.ts`  |
| [src/tools/get-comments.ts](../../src/tools/get-comments.ts)                               | `makeGetCommentsTool`                    | `tests/tools/comment-tools.test.ts`  |
| [src/logger.ts](../../src/logger.ts)                                                       | `logger`, `getLogLevel` (to export)      | `tests/logger.test.ts`               |
| [src/chat/telegram/format.ts](../../src/chat/telegram/format.ts)                           | `formatLlmOutput`                        | `tests/utils/format.test.ts`         |
| [src/providers/kaneo/add-task-label.ts](../../src/providers/kaneo/add-task-label.ts)       | `addTaskLabel`                           | `tests/e2e/label-operations.test.ts` |
| [src/providers/kaneo/remove-task-label.ts](../../src/providers/kaneo/remove-task-label.ts) | `removeTaskLabel`                        | `tests/e2e/label-operations.test.ts` |

## Appendix B: Test Helper Reference

| Helper                          | Location                       | Purpose                                                  |
| ------------------------------- | ------------------------------ | -------------------------------------------------------- |
| `setupTestDb()`                 | `tests/utils/test-helpers.ts`  | Creates in-memory SQLite DB with migrations              |
| `mockLogger()`                  | `tests/utils/test-helpers.ts`  | Stubs `src/logger.ts` exports                            |
| `mockDrizzle()`                 | `tests/utils/test-helpers.ts`  | Redirects `getDrizzleDb()` to test DB                    |
| `createMockProvider(overrides)` | `tests/tools/mock-provider.ts` | Creates mock `TaskProvider` with all methods stubbed     |
| `schemaValidates(tool, data)`   | `tests/test-helpers.ts`        | Tests if a tool's `inputSchema.safeParse(data)` succeeds |
| `getToolExecutor(tool)`         | `tests/test-helpers.ts`        | Extracts `execute` function from a tool for testing      |
