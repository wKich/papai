# Phase 4: Common-Sense Scenario Gaps — Detailed Test Plan

**Date:** 2026-03-22
**Status:** Draft
**Parent:** [2026-03-22-test-improvement-roadmap.md](2026-03-22-test-improvement-roadmap.md)
**Priority:** Medium
**Prerequisite:** Phase 1 (Fix false-confidence tests)

---

## Epic Overview

- **Business Value**: Close the "obvious" scenario gaps that a careful code review would flag — DB state verification after mutations, degenerate/edge inputs to tools, error paths for providers, and boundary conditions in core modules.
- **Success Metrics**: All command tests verify persistence after mutations; self-referential operations have documented tested behavior; Kaneo provider tests cover ≥3 HTTP error codes per resource; all provider error codes have `getUserMessage` tests; `bun test` green.
- **Priority**: Medium — these tests prevent subtle production bugs that existing tests miss because they only check reply text or happy-path outputs.

---

## Technical Architecture

- **Components**: 12 existing test files modified; 0 new source files; 0 new test files
- **Data Flow**: Each test calls source function → asserts on return value, DB state, mock call args, or thrown error
- **Integration Points**: Tests use existing patterns: `setupTestDb()` for DB, `createMockProvider()` for tool tests, `setMockFetch()`/`restoreFetch()` for Kaneo provider tests, spyOn for cache/config
- **Technology Stack**: Bun test runner, `bun:test` (mock, spyOn, describe, test, expect), drizzle-orm for DB assertions

---

## Detailed Task Breakdown

### Task 4.1 — Command Tests: DB State Verification (6 tests)

**Files:** `tests/commands/group.test.ts`, `tests/commands/admin.test.ts`, `tests/commands/set.test.ts`
**Source:** `src/commands/group.ts`, `src/commands/admin.ts`, `src/commands/set.ts`

Current gap: Command tests assert reply text but never verify that the underlying DB mutation actually persisted. A command could reply "User added" without calling `addGroupMember`.

#### 4.1.1 — `group.test.ts` adduser: verify persistence after add

- **Test name:** `'adduser persists member in DB'`
- **Setup:** Standard group test setup with admin user
- **Action:** Call handler with `createGroupMessage('admin1', 'adduser @user1', true)`
- **Assert:** After reply, call `listGroupMembers(groupContextId)` and verify the returned array contains an entry with `user_id` matching the extracted userId for `@user1`
- **Why it matters:** Current test only checks `textCalls[0]` matches expected reply — if `addGroupMember()` call is removed, test still passes
- **Estimate:** 0.5h | Priority: M
- **Dependencies:** None

#### 4.1.2 — `group.test.ts` deluser: verify removal after delete

- **Test name:** `'deluser removes member from DB'`
- **Setup:** Add user1 to group via `addGroupMember`, then call handler with `deluser @user1`
- **Assert:** After reply, call `listGroupMembers(groupContextId)` → array does NOT contain user1. Call `isGroupMember(groupContextId, userId)` if available and assert false.
- **Why it matters:** Same gap as 4.1.1 — reply text is asserted but not the DB side-effect
- **Estimate:** 0.5h | Priority: M
- **Dependencies:** None

#### 4.1.3 — `admin.test.ts` invalid identifier format

- **Test name:** `'rejects invalid identifier format with specific error'`
- **Setup:** Admin user in DM
- **Action:** Call handler with `createDmMessage(ADMIN_ID, 'add some@invalid!id')`
- **Assert:** Reply text contains 'Invalid identifier' (the `parseUserIdentifier` function returns null for input with `@` not at position 0 and special chars). `isAuthorized('some@invalid!id')` returns false.
- **Why it matters:** `parseUserIdentifier` validates input format — test documents the boundary between valid and invalid
- **Source reference:** `admin.ts` lines 9-18 — `parseUserIdentifier` rejects input with `@` not at start AND input that doesn't match `/^[a-zA-Z0-9_-]+$/`
- **Estimate:** 0.5h | Priority: L
- **Dependencies:** None

#### 4.1.4 — `admin.test.ts` provisionAndConfigure success path

- **Test name:** `'provision success replies with email, password, and URL'`
- **Setup:** Mock `provisionAndConfigure` to return `{ status: 'provisioned', email: 'bot-user@test.com', password: 'abc123', kaneoUrl: 'https://kaneo.test', apiKey: 'key', workspaceId: 'ws-1' }`
- **Action:** Call `/user add 12345` as admin
- **Assert:** Reply text array includes message containing email, password, and URL. `isAuthorized('12345')` returns true.
- **Why it matters:** `provisionUserKaneo` has a 'provisioned' code path that sends credentials via reply — never tested. Tests currently don't mock `provisionAndConfigure` so it either fails silently or is never reached.
- **Source reference:** `admin.ts` lines 93-101 — `provisionUserKaneo` checks `outcome.status`
- **Estimate:** 1h | Priority: M
- **Dependencies:** Requires mocking `provisionAndConfigure` at module level

#### 4.1.5 — `admin.test.ts` provisionAndConfigure failure path

- **Test name:** `'provision failure replies with failure note'`
- **Setup:** Mock `provisionAndConfigure` to return `{ status: 'failed', error: 'KANEO_CLIENT_URL not set' }`
- **Action:** Call `/user add 67890` as admin
- **Assert:** Reply text array includes message containing 'auto-provisioning failed'. `isAuthorized('67890')` returns true (user was still added, provisioning is secondary).
- **Why it matters:** The failure path sends a different reply than success — never tested
- **Source reference:** `admin.ts` lines 97-99
- **Estimate:** 0.5h | Priority: M
- **Dependencies:** Same mock as 4.1.4

#### 4.1.6 — `set.test.ts` value with spaces

- **Test name:** `'stores value that contains spaces'`
- **Setup:** Standard set test setup
- **Action:** Call handler with `createDmMessage(USER_ID, 'llm_baseurl https://example.com/v1 extra')`
- **Assert:** `getConfig(USER_ID, 'llm_baseurl')` returns `'https://example.com/v1 extra'` (everything after the first space following the key is the value)
- **Why it matters:** The `set.ts` handler splits on first space only (`match.indexOf(' ')`) — this documents the behavior for values containing spaces. Currently untested.
- **Source reference:** `set.ts` lines 23-25 — `spaceIndex = match.indexOf(' ')`, `value = match.slice(spaceIndex + 1).trim()`
- **Estimate:** 0.25h | Priority: L
- **Dependencies:** None

#### 4.1.7 — `set.test.ts` overwrite existing config value

- **Test name:** `'overwrites existing config value'`
- **Setup:** Call handler to set `main_model gpt-4o` first
- **Action:** Call handler again to set `main_model gpt-4o-mini`
- **Assert:** `getConfig(USER_ID, 'main_model')` returns `'gpt-4o-mini'`, NOT `'gpt-4o'`
- **Why it matters:** Verifies idempotent SET behavior — config should overwrite, not append or reject
- **Estimate:** 0.25h | Priority: L
- **Dependencies:** None

**Task 4.1 Subtotal:** 3.5h | 7 tests

---

### Task 4.2 — Tool Tests: Degenerate Inputs and Self-Referential Operations (5 tests)

**Files:** `tests/tools/task-relation-tools.test.ts`, `tests/tools/task-label-tools.test.ts`, `tests/tools/status-tools.test.ts`, `tests/tools/recurring-tools.test.ts`
**Source:** `src/tools/add-task-relation.ts`, `src/tools/update-task-relation.ts`, `src/tools/add-task-label.ts`, `src/tools/reorder-statuses.ts`, `src/tools/create-recurring-task.ts`

Current gap: Tools accept degenerate inputs (self-references, duplicates, empty arrays) without testing — behavior is undefined from a test perspective.

#### 4.2.1 — `task-relation-tools.test.ts` self-relation

- **Test name:** `'adding self-relation (taskId === relatedTaskId) — document behavior'`
- **Setup:** Create mock provider with `addTaskRelation` mock
- **Action:** Call `execute({ taskId: 'task-1', relatedTaskId: 'task-1', type: 'blocks' })`
- **Assert two scenarios — pick based on source behavior:**
  - If provider allows it: result contains `{ taskId: 'task-1', relatedTaskId: 'task-1' }` and `addTaskRelation` was called with `('task-1', 'task-1', 'blocks')`
  - If provider rejects it: expect thrown error or error result
- **Why it matters:** Self-referential relations are a classic edge case. The tool layer doesn't validate this — it delegates to the provider. Test documents what happens.
- **Source reference:** `src/tools/add-task-relation.ts` — no self-relation guard exists. The tool passes `taskId` and `relatedTaskId` directly to `provider.addTaskRelation`. In `src/providers/kaneo/task-relations.ts`, `addTaskRelation` would first validate the related task exists (same task), fetch the source task (same task again), and append a self-referencing relation to the description. This would succeed without error.
- **Expected behavior to document:** Self-relation is accepted — the tool layer does not validate this. The test should verify `addTaskRelation` was called and document this as accepted behavior.
- **Estimate:** 0.5h | Priority: M
- **Dependencies:** None

#### 4.2.2 — `task-relation-tools.test.ts` duplicate relation add

- **Test name:** `'adding duplicate relation (same taskId/relatedTaskId/type) — idempotent or error'`
- **Setup:** Mock provider returns success on first `addTaskRelation` call
- **Action:** Call `execute` twice with identical `{ taskId: 'task-1', relatedTaskId: 'task-2', type: 'blocks' }`
- **Assert:** Both calls succeed (the tool delegates to provider, and the Kaneo provider appends to frontmatter without dedup). Document that duplicate relations are allowed at the tool layer.
- **Why it matters:** Users may accidentally invoke the same tool twice — test documents whether duplicates are silently accepted
- **Source reference:** `src/providers/kaneo/frontmatter.ts` `addRelation` always appends — no dedup logic
- **Estimate:** 0.5h | Priority: M
- **Dependencies:** None

#### 4.2.3 — `task-label-tools.test.ts` adding label already on the task

- **Test name:** `'adding label already present on task — document behavior'`
- **Setup:** Mock provider `addTaskLabel` resolves successfully (provider doesn't error on duplicate)
- **Action:** Call `execute({ taskId: 'task-1', labelId: 'label-1' })`
- **Assert:** Result contains success message. `addTaskLabel` was called with `('task-1', 'label-1')`. Document that the tool layer does not check for pre-existing labels.
- **Why it matters:** The Kaneo API may or may not reject duplicate label assignments — test documents tool-layer behavior
- **Estimate:** 0.25h | Priority: L
- **Dependencies:** None

#### 4.2.4 — `status-tools.test.ts` reorderStatuses with empty statuses array

- **Test name:** `'reorderStatuses with empty statuses array'`
- **Setup:** Mock provider `reorderStatuses` resolves successfully
- **Action:** Call `execute({ projectId: 'proj-1', statuses: [] })`
- **Assert two scenarios based on Zod schema behavior:**
  - The Zod schema `z.array(z.object({...}))` accepts empty arrays. The tool proceeds to call `provider.reorderStatuses!('proj-1', [])`.
  - Verify `reorderStatuses` was called with `('proj-1', [])`.
  - Result is `{ success: true }`.
- **Why it matters:** Empty reorder is a no-op but could cause provider errors — test verifies it passes through cleanly
- **Source reference:** `src/tools/reorder-statuses.ts` — no minimum-length validation on the `statuses` array
- **Estimate:** 0.25h | Priority: L
- **Dependencies:** None

#### 4.2.5 — `recurring-tools.test.ts` on_complete with cronExpression provided

- **Test name:** `'on_complete triggerType ignores cronExpression when both provided'`
- **Setup:** Mock `createRecurringTask` as existing tests do
- **Action:** Call `execute({ title: 'Test', projectId: 'p-1', triggerType: 'on_complete', cronExpression: '0 9 * * 1' })`
- **Assert:**
  - Result does NOT contain an error — `on_complete` does not require `cronExpression` validation
  - `createRecurringTask` receives the `cronExpression` in its args (it's passed through)
  - But the `schedule` in the result is `'after completion of current instance'` (not a cron description)
- **Why it matters:** When `triggerType === 'on_complete'`, the code path skips cron validation entirely. But `cronExpression` is still passed to `createRecurringTask`. Test documents this behavior.
- **Source reference:** `src/tools/create-recurring-task.ts` lines 37-40 — only checks cron validity when `triggerType === 'cron'`. Lines 56-58 — schedule uses `describeCron` only when `triggerType === 'cron' && cronExpression !== null`.
- **Estimate:** 0.5h | Priority: M
- **Dependencies:** None

**Task 4.2 Subtotal:** 2h | 5 tests

---

### Task 4.3 — Provider Tests: Error Path Coverage (12 tests)

**Files:** `tests/providers/kaneo/task-resource.test.ts`, `tests/providers/kaneo/task-archive.test.ts`, `tests/providers/kaneo/client.test.ts`, `tests/providers/kaneo/task-relations.test.ts`
**Source:** `src/providers/kaneo/task-resource.ts`, `src/providers/kaneo/task-archive.ts`, `src/providers/kaneo/client.ts`, `src/providers/kaneo/task-relations.ts`

Current gap: Provider tests cover happy paths but few error paths. HTTP error codes (404, 401, 500) are under-tested.

#### 4.3.1a — `task-resource.test.ts` get returns 404

- **Test name:** `'get throws classifiedError for 404 (task not found)'`
- **Setup:** Mock fetch returns `{ ok: false, status: 404, json: () => ({ message: 'Not found' }) }`
- **Action:** Call `taskResource.get('nonexistent-id')`
- **Assert:** Thrown error is a classified error with code `'task-not-found'`
- **Estimate:** 0.5h | Priority: H
- **Dependencies:** None

#### 4.3.1b — `task-resource.test.ts` create with invalid project

- **Test name:** `'create throws classifiedError when projectId does not exist'`
- **Setup:** Mock fetch for `validateStatus` POST `/task/{projectId}` returns 404
- **Action:** Call `taskResource.create({ projectId: 'invalid', title: 'Test' })`
- **Assert:** Thrown error is classified with appropriate code (likely `'project-not-found'` or `'unknown'` depending on how classifyKaneoError maps the 404 on the task endpoint)
- **Estimate:** 0.5h | Priority: M
- **Dependencies:** None

#### 4.3.1c — `task-resource.test.ts` search with empty query

- **Test name:** `'search returns empty results for empty query string'`
- **Setup:** Mock fetch returns `{ tasks: [] }` for search endpoint
- **Action:** Call `taskResource.search('')` or `taskResource.search('  ')`
- **Assert:** Returns empty array, no errors thrown
- **Estimate:** 0.5h | Priority: L
- **Dependencies:** Requires reading `search-tasks.ts` to confirm method signature. If `TaskResource` doesn't have a `search` method, this test targets the standalone `searchTasks` function.

#### 4.3.2a — `task-archive.test.ts` addArchiveLabel when label already exists on task (idempotent re-archive)

- **Test name:** `'addArchiveLabel when task already has archive label — idempotent'`
- **Setup:** Mock fetch for `getOrCreateArchiveLabel` returns existing label, mock `labelResource.addToTask` succeeds
- **Action:** Call `addArchiveLabel(config, workspaceId, taskId)`
- **Assert:** No error thrown. `addToTask` was called (the function doesn't check pre-existence).
- **Why it matters:** Documents that re-archiving is safe — the function always calls `addToTask` regardless
- **Estimate:** 0.5h | Priority: M
- **Dependencies:** None

#### 4.3.2b — `task-archive.test.ts` isTaskArchived when API returns error

- **Test name:** `'isTaskArchived throws when labels endpoint returns 500'`
- **Setup:** Mock fetch for `/label/task/{taskId}` returns 500
- **Action:** Call `isTaskArchived(config, taskId, archiveLabelId)`
- **Assert:** Error is thrown (not swallowed) — `kaneoFetch` throws `KaneoApiError`
- **Estimate:** 0.25h | Priority: M
- **Dependencies:** None

#### 4.3.3a — `client.test.ts` network failure (fetch throws)

- **Test name:** `'throws when fetch itself throws (network failure)'`
- **Setup:** Mock `globalThis.fetch` to throw `new TypeError('Failed to fetch')` (simulates DNS failure, network down, etc.)
- **Action:** Call `kaneoFetch(config, 'GET', '/test', undefined, undefined, schema)`
- **Assert:** The TypeError propagates (not wrapped in KaneoApiError). This documents that `kaneoFetch` does NOT catch network-level errors — they propagate raw.
- **Why it matters:** Network failures are a different class from HTTP errors — test documents the behavior gap
- **Source reference:** `client.ts` — `fetch()` call is not wrapped in try/catch for network errors, only the response is checked via `response.ok`
- **Estimate:** 0.5h | Priority: H
- **Dependencies:** None

#### 4.3.3b — `client.test.ts` response body is not valid JSON on success

- **Test name:** `'throws when successful response has invalid JSON body'`
- **Setup:** Mock fetch returns `{ ok: true, status: 200, json: () => { throw new SyntaxError('Unexpected token') } }`
- **Action:** Call `kaneoFetch(config, 'GET', '/test', undefined, undefined, z.object({ id: z.string() }))`
- **Assert:** Error propagates — the `response.json()` call will throw
- **Estimate:** 0.25h | Priority: L
- **Dependencies:** None

#### 4.3.4a — `task-relations.test.ts` self-relation at provider level

- **Test name:** `'addTaskRelation with taskId === relatedTaskId succeeds (no guard)'`
- **Setup:** Mock fetch returns task data for both GET calls (same taskId)
- **Action:** Call `addTaskRelation(config, 'task-1', 'task-1', 'blocks')`
- **Assert:** No error. The PUT call updates description with a self-referencing `blocks: task-1` entry. Documents that the Kaneo provider has no self-relation guard.
- **Estimate:** 0.5h | Priority: M
- **Dependencies:** None

#### 4.3.4b — `task-relations.test.ts` all 6 relation types

- **Test name:** `'addTaskRelation works for all 6 relation types'`
- **Setup:** Mock fetch returns task data for each call
- **Action:** Call `addTaskRelation` with each of: `'blocks'`, `'blocked_by'`, `'duplicate'`, `'duplicate_of'`, `'related'`, `'parent'`
- **Assert:** For each type, the PUT request body contains the corresponding frontmatter line (e.g., `blocks: task-2`). All 6 calls succeed.
- **Why it matters:** Only `'blocks'`, `'related'`, `'duplicate'` are tested (3 of 6 types). `'blocked_by'`, `'duplicate_of'`, `'parent'` are untested.
- **Source reference:** `src/providers/kaneo/frontmatter.ts` line 6 — `TaskRelation['type']` has 6 variants
- **Estimate:** 1h | Priority: H
- **Dependencies:** None

#### 4.3.4c — `task-relations.test.ts` addTaskRelation when server returns 500 on PUT

- **Test name:** `'addTaskRelation throws classified error when description update fails'`
- **Setup:** Mock first two GETs succeed, but PUT returns 500
- **Action:** Call `addTaskRelation(config, 'task-1', 'task-2', 'blocks')`
- **Assert:** Error is thrown and is a classified Kaneo error (via `classifyKaneoError`)
- **Estimate:** 0.5h | Priority: M
- **Dependencies:** None

#### 4.3.4d — `task-relations.test.ts` updateTaskRelation when task has no frontmatter at all

- **Test name:** `'updateTaskRelation when task description has no frontmatter — throws relationNotFound'`
- **Setup:** Mock GET returns task with `description: 'Just plain text, no frontmatter'`
- **Action:** Call `updateTaskRelation(config, 'task-1', 'task-2', 'related')`
- **Assert:** Throws with `relationNotFound` error, since `parseRelationsFromDescription` returns empty relations and `.find()` returns undefined
- **Source reference:** `task-relations.ts` lines 104-113 — checks `existingRelation === undefined`
- **Estimate:** 0.5h | Priority: M
- **Dependencies:** None

**Task 4.3 Subtotal:** 5.5h | 12 tests

---

### Task 4.4 — Core Module Edge Cases (11 tests)

**Files:** `tests/conversation.test.ts`, `tests/memory.test.ts`, `tests/cron.test.ts`, `tests/users.test.ts`, `tests/errors.test.ts`
**Source:** `src/conversation.ts`, `src/memory.ts`, `src/cron.ts`, `src/users.ts`, `src/errors.ts`

Current gap: Boundary conditions, concurrent operations, and missing error code coverage in `getUserMessage`.

#### 4.4.1 — `conversation.test.ts` shouldTriggerTrim at exactly TRIM_MIN boundary

- **Test name:** `'returns false for exactly 50 messages with 25 user messages (boundary)'`
- **Setup:** Create 50 messages (alternating user/assistant → 25 user messages)
- **Action:** Call `shouldTriggerTrim(messages)`
- **Assert:** Returns `false` — the condition requires `history.length > TRIM_MIN` (strict greater), and `userMessageCount % 10 === 0` triggers at 20 and 30 but 25 is not 0 mod 10. With 50 messages at 25 user messages, `25 % 10 !== 0`, so periodic is false. And `50 < 100` so hard cap is false.
- **Additional boundary test:** `'returns true for exactly 50 messages with 20 user messages'` — Create messages such that exactly 20 are 'user'. Then `20 % 10 === 0` AND `50 > 50` is FALSE (not strictly greater), so still false. Need 51+ messages for periodic to fire.
- **Additional boundary test:** `'returns true for 51 messages with 20 user messages'` — `20 % 10 === 0 && 51 > 50` → true.
- **Source reference:** `conversation.ts` lines 29-33 — `periodicTrim = userMessageCount > 0 && userMessageCount % SMART_TRIM_INTERVAL === 0 && history.length > TRIM_MIN`
- **Estimate:** 0.5h | Priority: M (boundary conditions are prime mutation targets)
- **Dependencies:** None

#### 4.4.2 — `conversation.test.ts` runTrimInBackground concurrent calls

- **Test name:** `'runTrimInBackground concurrent calls for same user — both complete without corruption'`
- **Setup:** Mock `generateTextImpl` with a small delay. Set up cache spies.
- **Action:** Call `runTrimInBackground(userId, history1)` and `runTrimInBackground(userId, history2)` concurrently (both fire, both await)
- **Assert:** Neither call throws. Final history is valid (not corrupted). This documents that there's no mutex — last writer wins.
- **Why it matters:** `runTrimInBackground` is called from a fire-and-forget context. If two messages arrive quickly, two trims could race. Test documents the race condition behavior.
- **Source reference:** `conversation.ts` lines 37-67 — no locking, `setCachedHistory` called at end
- **Estimate:** 1h | Priority: M
- **Dependencies:** None

#### 4.4.3 — `memory.test.ts` trimWithMemoryModel with empty history

- **Test name:** `'trimWithMemoryModel with empty history returns empty'`
- **Setup:** `history = []`, `trimMin = 0`, `trimMax = 10`
- **Action:** Call `trimWithMemoryModel([], 0, 10, null, mockModel)`
- **Assert:** Returns `{ trimmedMessages: [], summary: <model output> }`. The model is called but with empty message text. This is a degenerate case — test documents it doesn't throw.
- **Source reference:** `memory.ts` lines 192-225 — empty history would produce empty `messagesText`, which is passed to the prompt. The model's response would have `keep_indices: []` (or whatever it returns), and `trimmedMessages` would be empty.
- **Estimate:** 0.25h | Priority: L
- **Dependencies:** None

#### 4.4.4 — `memory.test.ts` trimWithMemoryModel when generateText throws

- **Test name:** `'trimWithMemoryModel throws when generateText fails'`
- **Setup:** Override `generateTextImpl` to throw `new Error('LLM API failure')`
- **Action:** Call `trimWithMemoryModel(history, 2, 10, null, mockModel)`
- **Assert:** The error propagates — `trimWithMemoryModel` does NOT catch errors internally. `expect(promise).rejects.toThrow('LLM API failure')`.
- **Why it matters:** Callers (`runTrimInBackground`) wrap this in try/catch — but trimWithMemoryModel itself should propagate
- **Source reference:** `memory.ts` — `generateText` call at ~line 205 is not wrapped in try/catch within trimWithMemoryModel
- **Estimate:** 0.25h | Priority: M
- **Dependencies:** None

#### 4.4.5 — `cron.test.ts` parseCron with impossible date

- **Test name:** `'parseCron("0 0 31 2 *") parses but nextCronOccurrence skips impossible dates'`
- **Setup:** Parse `'0 0 31 2 *'` (Feb 31)
- **Action on parseCron:** Should return non-null (the parser doesn't validate cross-field logic — `31` is valid for dayOfMonth field range 1-31, `2` is valid for month)
- **Action on nextCronOccurrence:** Call with the parsed cron and a start date in January 2026
- **Assert:** `parseCron` returns a valid ParsedCron. `nextCronOccurrence` either:
  - Returns null (no valid occurrence within the scan window, since Feb never has 31 days), OR
  - Scans up to the internal limit and gives up
  - Document whichever behavior occurs
- **Why it matters:** Users may specify impossible dates — test documents whether the system handles it gracefully or loops forever
- **Source reference:** `cron.ts` `parseField` validates individual field bounds but not cross-field combos. `nextCronOccurrence` scans day by day up to a max iterations limit.
- **Estimate:** 0.5h | Priority: M
- **Dependencies:** None

#### 4.4.6 — `cron.test.ts` DST transition edge case

- **Test name:** `'nextCronOccurrence during spring-forward (2:30 AM gap) with timezone'`
- **Setup:** Parse `'30 2 * * *'` (2:30 AM daily), timezone `'America/New_York'`
- **Action:** Call `nextCronOccurrence(cron, new Date('2026-03-08T06:00:00Z'), 'America/New_York')` — March 8, 2026 is when US clocks spring forward (2:00 AM → 3:00 AM EST→EDT)
- **Assert:** The function returns a valid Date — either:
  - Skips March 8 and returns March 9 (since 2:30 AM doesn't exist on March 8 in ET), OR
  - Returns 3:00 AM ET (7:00 UTC) on March 8 as the closest match, OR
  - Returns the exact UTC equivalent treating the local time as if it existed
  - Document whichever behavior occurs
- **Why it matters:** DST is a notorious source of cron bugs. Test documents the system's behavior.
- **Estimate:** 0.5h | Priority: M
- **Dependencies:** None

#### 4.4.7 — `users.test.ts` addUser with duplicate ID but different username

- **Test name:** `'addUser with existing ID and new username overwrites username'`
- **Setup:** Call `addUser('123', 'admin')` (no username set)
- **Action:** Call `addUser('123', 'admin', 'newname')`
- **Assert:** `listUsers()` returns one entry with `platform_user_id: '123'` and `username: 'newname'`
- **Additional test:** `'addUser with existing ID replaces username with null when no username provided'`
- **Setup:** Call `addUser('456', 'admin', 'oldname')`
- **Action:** Call `addUser('456', 'admin')` (no username)
- **Assert:** `listUsers()` returns entry with `username: null` — the `onConflictDoUpdate` sets `username: username ?? null`
- **Why it matters:** The `onConflictDoUpdate` behavior is critical for the username resolution flow — test documents that re-adding a user overwrites the username
- **Source reference:** `users.ts` lines 22-28 — `onConflictDoUpdate` with `set: { username: username ?? null }`
- **Estimate:** 0.5h | Priority: M
- **Dependencies:** None

#### 4.4.8 — `errors.test.ts` getUserMessage for 5 missing provider error codes

- **Test name:** `'getUserMessage returns correct message for projectNotFound'`
- **Assert:** `getUserMessage(providerError.projectNotFound('proj-1'))` contains `'proj-1'` and matches the template `'Project "proj-1" was not found.'`

- **Test name:** `'getUserMessage returns correct message for commentNotFound'`
- **Assert:** `getUserMessage(providerError.commentNotFound('cmt-1'))` contains `'cmt-1'`

- **Test name:** `'getUserMessage returns correct message for relationNotFound'`
- **Assert:** `getUserMessage(providerError.relationNotFound('t-1', 't-2'))` contains both `'t-1'` and `'t-2'`

- **Test name:** `'getUserMessage returns correct message for statusNotFound'`
- **Assert:** `getUserMessage(providerError.statusNotFound('in-progress', ['to-do', 'done']))` contains `'in-progress'` and contains `'to-do'`

- **Test name:** `'getUserMessage returns correct message for invalidResponse'`
- **Assert:** `getUserMessage(providerError.invalidResponse())` contains `'unexpected response'`

- **Why these are missing:** The existing `getUserMessage for provider errors` test checks 8 of 13 codes. These 5 are untested: `projectNotFound`, `commentNotFound`, `relationNotFound`, `statusNotFound`, `invalidResponse`
- **Source reference:** `src/providers/errors.ts` lines 68-92 — all 13 cases in `getProviderMessage` switch
- **Current coverage:** `errors.ts` has `[Survived]` mutation on the `invalid-input` case (line 52 in errors.ts) — adding these tests will kill more mutants
- **Estimate:** 0.5h | Priority: H (95% mutation score → these 5 tests could push it to 100%)
- **Dependencies:** None

**Task 4.4 Subtotal:** 4h | 11+ tests

---

## Risk Assessment Matrix

| Risk                                                                                                              | Probability | Impact | Mitigation                                                                                                                                                   | Owner |
| ----------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| `provisionAndConfigure` mock complexity — function has deep dependency tree (fetch, crypto, env vars)             | Medium      | Medium | Mock at module level using `mock.module('../../src/providers/kaneo/provision.js', ...)` — only need to control the return value, not internals               | Dev   |
| Concurrent `runTrimInBackground` test is timing-sensitive                                                         | Medium      | Low    | Use mock `generateTextImpl` with `Promise.resolve` (no real delay) — test sequence, not timing. Both calls should complete without error.                    | Dev   |
| DST test may behave differently on CI vs local depending on system timezone data                                  | Low         | Low    | Use explicit `'America/New_York'` timezone and specific dates. Assert only on the behavior pattern (skips or offsets), not exact UTC timestamp if uncertain. | Dev   |
| `parseCron('0 0 31 2 *')` / `nextCronOccurrence` may have an internal iteration limit that causes null return     | Medium      | Low    | Test for both possible outcomes (null or valid date). The point is documenting behavior, not asserting a specific outcome.                                   | Dev   |
| Some Kaneo provider tests require complex multi-fetch mocking (sequential fetch calls return different responses) | Medium      | Medium | Use the existing `setMockFetch` pattern from `test-resources.ts` which supports request-based routing. Counter-based mocking for sequential calls.           | Dev   |
| `addUser` conflict behavior depends on SQLite/drizzle version behavior for `onConflictDoUpdate`                   | Low         | Low    | Use `setupTestDb()` which mirrors production schema — behavior will match.                                                                                   | Dev   |

---

## Library & Framework Research

No new libraries needed. All tests use existing infrastructure:

- **Bun test runner** (`bun:test`): `mock`, `spyOn`, `describe`, `test`, `expect`, `beforeEach`, `afterEach` — already in use across all 74 test files
- **drizzle-orm**: For DB assertions in command tests — already imported in `admin.test.ts`, `group.test.ts`
- **Existing test helpers**: `setupTestDb()`, `createMockReply()`, `createDmMessage()`, `createMockProvider()`, `setMockFetch()`/`restoreFetch()`, `clearUserCache()`, `flushMicrotasks()`

---

## Resource Requirements

- **Development Hours:** 15h total (3.5 + 2 + 5.5 + 4)
- **Skills Required:** Bun test runner knowledge, mock patterns (module mocks, spyOn), drizzle-orm assertions, Kaneo API structure understanding
- **External Dependencies:** None
- **Testing Requirements:** `bun test` green after each subtask; mutation testing validation on `errors.ts` after Task 4.4.8

---

## Implementation Order

Recommended implementation sequence (by priority and dependency):

```
1. Task 4.4.8 — Provider error getUserMessage gaps (H priority, 0.5h, quick win)
2. Task 4.3.4b — All 6 relation types (H priority, 1h, high mutation-kill value)
3. Task 4.3.1a — task-resource get 404 (H priority, 0.5h)
4. Task 4.3.3a — client network failure (H priority, 0.5h)
5. Task 4.1.4 + 4.1.5 — admin provisionAndConfigure paths (M priority, 1.5h, share mock setup)
6. Task 4.1.1 + 4.1.2 — group adduser/deluser DB verification (M priority, 1h)
7. Task 4.2.1 + 4.2.2 — relation self/duplicate (M priority, 1h)
8. Task 4.4.1 — shouldTriggerTrim boundary (M priority, 0.5h)
9. Task 4.4.5 + 4.4.6 — cron edge cases (M priority, 1h)
10. Task 4.4.7 — users addUser overwrite (M priority, 0.5h)
11. Task 4.4.2 — concurrent trim (M priority, 1h)
12. Task 4.4.4 — trimWithMemoryModel throws (M priority, 0.25h)
13. Task 4.2.5 — on_complete with cron (M priority, 0.5h)
14. Task 4.3.4a + 4.3.4c + 4.3.4d — remaining relation provider tests (M priority, 1.5h)
15. Task 4.3.1b + 4.3.1c + 4.3.2a + 4.3.2b + 4.3.3b — remaining provider tests (M/L, 2h)
16. Task 4.1.3 + 4.1.6 + 4.1.7 — remaining command tests (L priority, 1h)
17. Task 4.2.3 + 4.2.4 — remaining tool tests (L priority, 0.5h)
18. Task 4.4.3 — trimWithMemoryModel empty (L priority, 0.25h)
```

---

## Phase 4 Definition of Done

- [ ] All command tests verify DB state after mutations (not just reply text)
  - `group.test.ts`: `listGroupMembers` called after adduser/deluser
  - `admin.test.ts`: `provisionAndConfigure` success/failure paths tested
  - `set.test.ts`: overwrite and space-in-value scenarios covered
- [ ] Self-referential operations have documented, tested behavior
  - `task-relation-tools.test.ts`: self-relation test with explicit behavior documentation
  - `task-relation-tools.test.ts`: duplicate relation test
  - `task-label-tools.test.ts`: duplicate label assignment test
- [ ] Kaneo provider tests cover ≥3 HTTP error codes per resource operation
  - `task-resource.test.ts`: 404, 500, invalid project
  - `task-archive.test.ts`: idempotent re-archive, 500 on labels endpoint
  - `client.test.ts`: network failure (fetch throws), invalid JSON response
  - `task-relations.test.ts`: self-relation, all 6 types, 500 on PUT, no-frontmatter update
- [ ] Each missing provider error code has a `getUserMessage` test
  - `errors.test.ts`: `projectNotFound`, `commentNotFound`, `relationNotFound`, `statusNotFound`, `invalidResponse`
- [ ] `bun test` green
- [ ] No `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, `oxlint-disable`

---

## Mutation Testing Targets

After Phase 4 completion, re-run mutation testing on these files to validate improvement:

| File                                    | Current Score | Expected After Phase 4                                 |
| --------------------------------------- | ------------- | ------------------------------------------------------ |
| `src/errors.ts`                         | 95%           | 100% (5 missing `getUserMessage` cases covered)        |
| `src/providers/errors.ts`               | 75%           | 85%+ (all `getProviderMessage` switch cases exercised) |
| `src/users.ts`                          | 42%           | 50%+ (addUser conflict behavior tested)                |
| `src/memory.ts`                         | 61%           | 65%+ (empty/error paths added)                         |
| `src/providers/kaneo/task-relations.ts` | 58%           | 70%+ (all 6 types, self-relation, error paths)         |
| `src/providers/kaneo/client.ts`         | 32%           | 40%+ (network failure, invalid JSON)                   |

---

## Test Count Summary

| Task      | File(s) Modified              | New Tests        | Priority |
| --------- | ----------------------------- | ---------------- | -------- |
| 4.1.1     | `group.test.ts`               | 1                | M        |
| 4.1.2     | `group.test.ts`               | 1                | M        |
| 4.1.3     | `admin.test.ts`               | 1                | L        |
| 4.1.4     | `admin.test.ts`               | 1                | M        |
| 4.1.5     | `admin.test.ts`               | 1                | M        |
| 4.1.6     | `set.test.ts`                 | 1                | L        |
| 4.1.7     | `set.test.ts`                 | 1                | L        |
| 4.2.1     | `task-relation-tools.test.ts` | 1                | M        |
| 4.2.2     | `task-relation-tools.test.ts` | 1                | M        |
| 4.2.3     | `task-label-tools.test.ts`    | 1                | L        |
| 4.2.4     | `status-tools.test.ts`        | 1                | L        |
| 4.2.5     | `recurring-tools.test.ts`     | 1                | M        |
| 4.3.1a    | `task-resource.test.ts`       | 1                | H        |
| 4.3.1b    | `task-resource.test.ts`       | 1                | M        |
| 4.3.1c    | `task-resource.test.ts`       | 1                | L        |
| 4.3.2a    | `task-archive.test.ts`        | 1                | M        |
| 4.3.2b    | `task-archive.test.ts`        | 1                | M        |
| 4.3.3a    | `client.test.ts`              | 1                | H        |
| 4.3.3b    | `client.test.ts`              | 1                | L        |
| 4.3.4a    | `task-relations.test.ts`      | 1                | M        |
| 4.3.4b    | `task-relations.test.ts`      | 6 (one per type) | H        |
| 4.3.4c    | `task-relations.test.ts`      | 1                | M        |
| 4.3.4d    | `task-relations.test.ts`      | 1                | M        |
| 4.4.1     | `conversation.test.ts`        | 3                | M        |
| 4.4.2     | `conversation.test.ts`        | 1                | M        |
| 4.4.3     | `memory.test.ts`              | 1                | L        |
| 4.4.4     | `memory.test.ts`              | 1                | M        |
| 4.4.5     | `cron.test.ts`                | 1                | M        |
| 4.4.6     | `cron.test.ts`                | 1                | M        |
| 4.4.7     | `users.test.ts`               | 2                | M        |
| 4.4.8     | `errors.test.ts`              | 5                | H        |
| **Total** | **12 files**                  | **~41 tests**    |          |
