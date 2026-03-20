# Phase 01: Code Quality & Reliability — Development Plan

**Created**: 2026-03-20  
**Scope**: User stories from `docs/user-stories/phase-01-code-quality-reliability.md`  
**Runtime**: Bun  
**Test runner**: `bun:test`  
**Linter**: oxlint (no `eslint-disable`, no `@ts-ignore`)

---

## Epic Overview

- **Business Value**: Users receive actionable feedback for every bot interaction; admins can diagnose failures quickly from structured logs. The bot never silently swallows errors.
- **Success Metrics**:
  - Every tool error surfaces a human-readable explanation in the chat reply
  - An unrecognised status name reply includes the list of valid options
  - A network-level failure reply explicitly says the tracker is unavailable and suggests retrying
  - A malformed API response does not crash the bot and does produce a coherent reply
  - Every error log entry contains: timestamp, level, scope, userId (where available), affected operation, and error reason — no sensitive data
- **Priority**: High — foundational stability before capability expansion

---

## Current State Audit

### What is already in place

| Area                                                                         | Status      |
| ---------------------------------------------------------------------------- | ----------- |
| `ProviderError` discriminated union (12 codes)                               | ✅ Complete |
| `getUserMessage()` mapping `AppError` → user string                          | ✅ Complete |
| `classifyKaneoError()` mapping HTTP/validation errors                        | ✅ Complete |
| `pino` structured logger with child scopes                                   | ✅ Complete |
| `handleMessageError()` in `llm-orchestrator.ts` dispatching via `isAppError` | ✅ Complete |
| `KaneoValidationError` thrown on Zod schema failure in `kaneoFetch`          | ✅ Complete |

### Confirmed gaps (mapped to user stories)

| Gap                                                                                                                          | Story | File(s)                                                             |
| ---------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------- |
| `classifyKaneoError` uses hardcoded `'unknown'` for entity IDs on 404                                                        | 1     | `src/providers/kaneo/classify-error.ts`                             |
| `YouTrack classifyYouTrackError` uses hardcoded `'unknown'` for entity IDs on 404                                            | 1     | `src/providers/youtrack/classify-error.ts`                          |
| `validateStatus()` throws a plain `new Error(...)` — escapes classification                                                  | 2     | `src/providers/kaneo/task-status.ts`                                |
| Network-level fetch failures (`TypeError: Failed to fetch`) → `systemError.unexpected` instead of `systemError.networkError` | 3     | `src/providers/kaneo/client.ts`, `src/providers/youtrack/client.ts` |
| `getSystemMessage('unexpected')` says "An unexpected error occurred" (not specific enough for network failures)              | 3     | `src/errors.ts`                                                     |
| `providerError.validationFailed('response', …)` produces non-user-friendly message for schema validation failures            | 4     | `src/providers/errors.ts`                                           |
| `handleMessageError` in `llm-orchestrator.ts` does not log the error details with userId                                     | 5     | `src/llm-orchestrator.ts`                                           |
| `handleMessageError` does not handle `KaneoClassifiedError` (Error subclass with `.appError`)                                | 6     | `src/llm-orchestrator.ts`, `src/providers/kaneo/classify-error.ts`  |

---

## Technical Architecture

### Component Map

```
User message
  └─ processMessage (llm-orchestrator.ts)
       └─ callLlm → generateText (AI SDK)
            └─ tool.execute (tools/*.ts)
                 └─ provider.method (providers/kaneo/index.ts)
                      ├─ kaneoFetch (client.ts)         ← network errors
                      │    ├─ HTTP 4xx/5xx              ← KaneoApiError
                      │    └─ Zod parse failure         ← KaneoValidationError
                      ├─ validateStatus (task-status.ts) ← plain Error today
                      └─ classifyKaneoError              ← KaneoClassifiedError
                           └─ .appError: AppError
  └─ handleMessageError
       └─ isAppError / KaneoClassifiedError detection
            └─ getUserMessage → reply.text
```

### Data Flow for Error Reporting

```
KaneoApiError (HTTP 4xx/5xx)
  → classifyKaneoError → KaneoClassifiedError { .appError: ProviderError }
  → tool re-throws → AI SDK handles as tool result error
  → LLM sees error message string (raw HTTP message today)

Goal after this plan:
  → classifyKaneoError → KaneoClassifiedError { .appError: ProviderError with real entity ID }
  → tool catches, returns { error: getUserMessage(appError) }  [or re-throws and LLM sees friendly msg]
  → handleMessageError also detects KaneoClassifiedError and calls getUserMessage(.appError)
```

### No new libraries required

All required functionality is already available via:

- `zod` (already used) — schema validation
- `pino` (already used) — structured logging
- `bun:test` (already used) — test runner

---

## Detailed Task Breakdown

### Story 1: Preserve Entity IDs in 404 Error Classification

**Objective**: When `classifyKaneoError` classifies a `KaneoApiError` with HTTP 404, propagate the actual entity ID (from the request URL or context) rather than hardcoding `'unknown'`.

#### Task 1.1 — Add `taskId`/`projectId` context parameter to `classifyKaneoError`

- **File**: `src/providers/kaneo/classify-error.ts`
- **Change**: Add optional `context?: { taskId?: string; projectId?: string; commentId?: string; labelName?: string }` parameter to `classifyKaneoError`. When classifying a 404, use `context.taskId ?? 'unknown'` etc.
- **Estimate**: 1h ±0.5h | **Priority**: High
- **Acceptance Criteria**:
  - `classifyKaneoError(404Error, { taskId: 'TASK-1' })` produces `ProviderError` with `taskId: 'TASK-1'`
  - Existing callers without context continue to work (parameter is optional)
- **Dependencies**: None

#### Task 1.2 — Pass context when calling `classifyKaneoError` in provider operations

- **Files**: `src/providers/kaneo/get-task.ts`, `src/providers/kaneo/update-task.ts`, `src/providers/kaneo/archive-task.ts`, `src/providers/kaneo/delete-task.ts`, `src/providers/kaneo/task-resource.ts`
- **Change**: Each `catch` block calls `classifyKaneoError(error, { taskId })` or `classifyKaneoError(error, { projectId })` using the known request parameter.
- **Estimate**: 1.5h ±0.5h | **Priority**: High
- **Acceptance Criteria**:
  - `provider.getTask('NONEXISTENT')` throws `KaneoClassifiedError` with `appError.taskId === 'NONEXISTENT'`
  - User message reads: `Task "NONEXISTENT" was not found. Please check the task ID and try again.`
- **Dependencies**: Task 1.1

#### Task 1.3 — Mirror fix in `classifyYouTrackError`

- **File**: `src/providers/youtrack/classify-error.ts`
- **Change**: Same context pattern as Kaneo — add optional context parameter; callers (YouTrack operations) pass the entity ID.
- **Estimate**: 1h ±0.5h | **Priority**: Medium
- **Acceptance Criteria**: YouTrack 404 errors include the actual entity ID in the error message
- **Dependencies**: Task 1.1 (pattern established)

#### Task 1.4 — Tests for entity-ID preservation

- **File**: `tests/providers/kaneo/classify-error.test.ts` (new), `tests/providers/youtrack/classify-error.test.ts` (new or extend)
- **Test cases**:
  - `classifyKaneoError(new KaneoApiError('...', 404, {}), { taskId: 'T-1' })` → appError has `taskId: 'T-1'`
  - `classifyKaneoError(new KaneoApiError('...', 404, {}))` (no context) → appError has `taskId: 'unknown'`
  - User message for `task-not-found` with real ID contains the real ID
- **Estimate**: 1h ±0.5h | **Priority**: High
- **Dependencies**: Tasks 1.1–1.3

---

### Story 2: Typed Error for Unrecognised Status Names

**Objective**: Replace the plain `new Error(...)` thrown by `validateStatus()` with a classified `KaneoClassifiedError` carrying `providerError.validationFailed('status', ...)`. This ensures the LLM and `handleMessageError` both receive a friendly, structured error with the available status list.

#### Task 2.1 — Add `status-not-found` code to `ProviderError`

- **Files**: `src/providers/errors.ts`
- **Change**: Add new `ProviderError` variant:
  ```ts
  | { type: 'provider'; code: 'status-not-found'; statusName: string; available: string[] }
  ```
  Add constructor `providerError.statusNotFound(statusName, available)` and user message:
  `Status "${statusName}" is not recognised. Available statuses: ${available.join(', ')}.`
- **Estimate**: 0.5h | **Priority**: High
- **Acceptance Criteria**:
  - `providerError.statusNotFound('Review', ['To Do', 'In Progress', 'Done'])` produces the correct structure
  - `getUserMessage(...)` returns a message listing available options
- **Dependencies**: None

#### Task 2.2 — Convert `validateStatus()` to throw a classified error

- **File**: `src/providers/kaneo/task-status.ts`
- **Change**: Import `KaneoClassifiedError` and `providerError`. Replace the final `throw new Error(...)` with:
  ```ts
  const available = columns.map((c) => c.name)
  throw new KaneoClassifiedError(
    `Invalid status "${status}". Must match one of: ${available.join(', ')}`,
    providerError.statusNotFound(status, available),
  )
  ```
- **Estimate**: 0.5h | **Priority**: High
- **Acceptance Criteria**:
  - `validateStatus(config, 'proj', 'Review')` throws `KaneoClassifiedError` with `appError.code === 'status-not-found'`
  - The available list in the error payload matches what `listColumns` returned
- **Dependencies**: Task 2.1

#### Task 2.3 — Ensure `classifyKaneoError` does not re-wrap `KaneoClassifiedError`

- **File**: `src/providers/kaneo/classify-error.ts`
- **Change**: The existing early-return guard `if (error instanceof KaneoClassifiedError) return error` already handles this. Verify test coverage confirms it.
- **Estimate**: 0.25h (review only) | **Priority**: High
- **Dependencies**: Task 2.2

#### Task 2.4 — Tests for unrecognised status feedback

- **File**: `tests/providers/kaneo/task-status.test.ts` (new or extend)
- **Test cases**:
  - `validateStatus` with a valid status name resolves with the slug
  - `validateStatus` with an invalid status name throws `KaneoClassifiedError` with `appError.code === 'status-not-found'`
  - The error payload's `available` array contains the column names returned by `listColumns`
  - `getUserMessage(error.appError)` includes the invalid name and lists available options
- **Estimate**: 1h ±0.5h | **Priority**: High
- **Dependencies**: Tasks 2.1–2.3

---

### Story 3: Transparent Network Failure Messages

**Objective**: When `kaneoFetch` or the YouTrack client fails due to a network error (no HTTP response), classify it as `systemError.networkError` (not `systemError.unexpected`) so the user receives "task tracker is unavailable, please try again" rather than a generic error.

#### Task 3.1 — Detect network errors in `classifyKaneoError`

- **File**: `src/providers/kaneo/classify-error.ts`
- **Change**: Before the final fallback, add detection of fetch API network errors:
  ```ts
  if (
    error instanceof TypeError &&
    (error.message.includes('fetch') ||
      error.message.includes('network') ||
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('ENOTFOUND') ||
      error.message.includes('connect'))
  ) {
    return new KaneoClassifiedError(error.message, systemError.networkError(error.message))
  }
  ```
- **Estimate**: 0.5h | **Priority**: High
- **Acceptance Criteria**:
  - `classifyKaneoError(new TypeError('fetch failed'))` → appError is `systemError.networkError(...)`
  - `classifyKaneoError(new Error('ECONNREFUSED'))` → appError is `systemError.networkError(...)`
- **Dependencies**: None

#### Task 3.2 — Mirror detection in `classifyYouTrackError`

- **File**: `src/providers/youtrack/classify-error.ts`
- **Change**: Same network-error detection pattern before the final `systemError.unexpected` fallback.
- **Estimate**: 0.5h | **Priority**: Medium
- **Dependencies**: Task 3.1 (pattern established)

#### Task 3.3 — Tests for network unavailability

- **File**: `tests/providers/kaneo/classify-error.test.ts`
- **Test cases**:
  - `classifyKaneoError(new TypeError('fetch failed'))` → `appError` is `{ type: 'system', code: 'network-error', ... }`
  - `getUserMessage` for `network-error` contains "unavailable" or "connection"
  - `classifyKaneoError(new TypeError('ECONNREFUSED'))` → same
- **Estimate**: 0.75h | **Priority**: High
- **Dependencies**: Tasks 3.1–3.2

---

### Story 4: User-Friendly Message for Malformed API Responses

**Objective**: When `kaneoFetch` throws a `KaneoValidationError` (Zod schema mismatch), the classified error should produce a message like "The task tracker returned an unexpected response. Please try again." instead of "Invalid response: Kaneo API GET /task/1 returned invalid data".

#### Task 4.1 — Refine the user message for `validationFailed('response', ...)`

Two approaches — prefer (a) since it avoids changing the `ProviderError` type:

**(a) Add `invalid-response` code to `ProviderError`** (preferred)

- **File**: `src/providers/errors.ts`
- **Change**: Add:
  ```ts
  | { type: 'provider'; code: 'invalid-response' }
  ```
  Constructor: `providerError.invalidResponse(): ProviderError`
  Message: `"The task tracker returned an unexpected response. Please try again."`
- **Estimate**: 0.5h | **Priority**: Medium
- **Acceptance Criteria**: `getUserMessage(providerError.invalidResponse())` returns the expected message

**(b) Alternative** — Update `classifyKaneoError` to use `providerError.invalidResponse()` when classifying `KaneoValidationError`.

#### Task 4.2 — Use `invalidResponse` when classifying `KaneoValidationError`

- **File**: `src/providers/kaneo/classify-error.ts`
- **Change**: Replace:
  ```ts
  if (error instanceof KaneoValidationError) {
    return new KaneoClassifiedError(error.message, providerError.validationFailed('response', error.message))
  }
  ```
  with:
  ```ts
  if (error instanceof KaneoValidationError) {
    return new KaneoClassifiedError(error.message, providerError.invalidResponse())
  }
  ```
- **Estimate**: 0.25h | **Priority**: Medium
- **Dependencies**: Task 4.1

#### Task 4.3 — Tests for malformed response handling

- **File**: `tests/providers/kaneo/classify-error.test.ts`
- **Test cases**:
  - `classifyKaneoError(new KaneoValidationError('...', zodError))` → `appError.code === 'invalid-response'`
  - `getUserMessage(appError)` is user-friendly (does not expose internal path names)
  - Bot does not crash when a task response is missing `id` or `title` (test with mock returning `{}`)
- **Estimate**: 0.75h | **Priority**: Medium
- **Dependencies**: Tasks 4.1–4.2

---

### Story 5: Structured Diagnostic Logging

**Objective**: `handleMessageError` logs the error (type, code, userId) before replying. Tool-level error logs include structured fields, not just string messages.

#### Task 5.1 — Log errors in `handleMessageError` with userId

- **File**: `src/llm-orchestrator.ts`
- **Change**: Use the `_userId` parameter (currently unused for logging). Add structured log entry before `reply.text(...)`:
  ```ts
  const handleMessageError = async (reply: ReplyFn, userId: string, error: unknown): Promise<void> => {
    log.error(
      { userId, error: isAppError(error) ? error : error instanceof Error ? error.message : String(error) },
      'Message handling failed',
    )
    // ... existing reply logic
  }
  ```
  Remove the underscore prefix from `_userId` → `userId`.
- **Estimate**: 0.5h | **Priority**: High
- **Acceptance Criteria**:
  - Every `handleMessageError` invocation writes a `pino` error-level entry with `userId` and error detail
  - No API keys or message content appears in log entries (review log output in test)
- **Dependencies**: None

#### Task 5.2 — Verify tool-level error logging includes structured fields

- **File**: Multiple `src/tools/*.ts`
- **Review**: Confirm all `log.error` calls use object form `{ error: ..., taskId, tool }` — not string interpolation.
- **Change (if needed)**: Replace any `log.error(\`Failed: ${err.message}\`)`with`log.error({ error: err.message }, 'Failed')`.
- **Estimate**: 0.5h | **Priority**: Medium
- **Acceptance Criteria**: All error log calls in `src/tools/` follow `log.error({ ...context }, 'message')` pattern
- **Dependencies**: None

#### Task 5.3 — Tests for diagnostic log output

- **File**: `tests/logger.test.ts` (extend) or new `tests/providers/kaneo/logging.test.ts`
- **Test cases**:
  - Simulate a failing tool call and assert `log.error` was called with `{ userId, error }` fields (use pino's `destination` or mock the logger child)
  - Assert no sensitive words (`apikey`, `password`, `token`) appear in log output for known test scenarios
- **Estimate**: 1h ±0.5h | **Priority**: Medium
- **Dependencies**: Task 5.1

---

### Story 6: No Silent Failures

**Objective**: `handleMessageError` handles `KaneoClassifiedError` (Error subclass with `.appError`) in addition to bare `AppError` objects, ensuring every tool failure produces a user-visible reply.

#### Task 6.1 — Detect `KaneoClassifiedError` in `handleMessageError`

- **File**: `src/llm-orchestrator.ts`
- **Change**: Import `KaneoClassifiedError`. In `handleMessageError`, add a check before the generic fallback:

  ```ts
  import { KaneoClassifiedError } from './providers/kaneo/classify-error.js'

  const handleMessageError = async (reply: ReplyFn, userId: string, error: unknown): Promise<void> => {
    log.error({ userId, error: ... }, 'Message handling failed')
    if (isAppError(error)) {
      await reply.text(getUserMessage(error))
    } else if (error instanceof KaneoClassifiedError) {
      await reply.text(getUserMessage(error.appError))
    } else if (APICallError.isInstance(error)) {
      await reply.text('An unexpected error occurred. Please try again later.')
    } else {
      await reply.text('An unexpected error occurred. Please try again later.')
    }
  }
  ```

- **Estimate**: 0.5h | **Priority**: High
- **Acceptance Criteria**:
  - `handleMessageError(reply, userId, new KaneoClassifiedError('msg', providerError.taskNotFound('T-1')))` → reply receives the task-not-found message, not generic fallback
- **Dependencies**: Task 5.1 (logging already added)

#### Task 6.2 — Also handle `ProviderClassifiedError` (from `src/providers/errors.ts`)

- **File**: `src/llm-orchestrator.ts`
- **Change**: Import `ProviderClassifiedError` and handle it:
  ```ts
  } else if (error instanceof ProviderClassifiedError) {
    await reply.text(getUserMessage(error.error))
  }
  ```
- **Estimate**: 0.25h | **Priority**: Medium
- **Dependencies**: Task 6.1

#### Task 6.3 — Tests for complete error path coverage

- **File**: `tests/` (new `tests/llm-orchestrator-errors.test.ts` or extend `tests/bot.test.ts`)
- **Test cases** (unit-level, mock `reply`):
  - `handleMessageError(reply, userId, providerError.taskNotFound('T-1'))` → reply.text called with task-not-found message
  - `handleMessageError(reply, userId, new KaneoClassifiedError('...', providerError.taskNotFound('T-1')))` → same
  - `handleMessageError(reply, userId, new Error('unknown'))` → reply.text called with generic message
  - `handleMessageError(reply, userId, systemError.networkError('Connection refused'))` → reply.text contains "unavailable" or "connection"

  > ⚠️ Note: `handleMessageError` is not exported today. Refactor to either export it for testing, or test the full `processMessage` path with a mocked provider that throws.

- **Estimate**: 1.5h ±0.5h | **Priority**: High
- **Dependencies**: Tasks 6.1–6.2

---

## Sequencing & Dependencies

```
Story 1:  1.1 → 1.2 → 1.4
           └──> 1.3 (YouTrack, parallel with 1.2)

Story 2:  2.1 → 2.2 → 2.3 (review) → 2.4

Story 3:  3.1 → 3.3
           └──> 3.2 (YouTrack, parallel with 3.1)

Story 4:  4.1 → 4.2 → 4.3

Story 5:  5.1 ─────────────────→ 5.3
          5.2 (independent)

Story 6:  5.1 (log in handler) → 6.1 → 6.2 → 6.3
```

**Recommended implementation order** (respects dependencies, groups related changes):

1. **Batch A** — Pure error type additions (no behavior change, easy to review):
   - Task 2.1 (`status-not-found` in ProviderError)
   - Task 4.1 (`invalid-response` in ProviderError)

2. **Batch B** — Classification logic (behavior changes in error layer):
   - Task 1.1 + 1.2 (entity IDs in Kaneo classify)
   - Task 1.3 (entity IDs in YouTrack classify)
   - Task 2.2 + 2.3 (validateStatus → classified error)
   - Task 3.1 + 3.2 (network error detection)
   - Task 4.2 (use invalidResponse for KaneoValidationError)

3. **Batch C** — Orchestrator & logging:
   - Task 5.1 (log in handleMessageError)
   - Task 5.2 (audit tool log calls)
   - Task 6.1 + 6.2 (handle KaneoClassifiedError + ProviderClassifiedError)

4. **Batch D** — Tests:
   - Task 1.4 (classify-error tests)
   - Task 2.4 (task-status tests)
   - Task 3.3 (network error tests)
   - Task 4.3 (malformed response tests)
   - Task 5.3 (logging tests)
   - Task 6.3 (end-to-end error path tests)

---

## Risk Assessment Matrix

| Risk                                                                                                                 | Probability | Impact | Mitigation                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------- | ----------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validateStatus` callers (task-resource) catch and re-wrap the new `KaneoClassifiedError`                            | Medium      | High   | The `classifyKaneoError` guard `if (error instanceof KaneoClassifiedError) return error` is already in place — verify it is exercised in tests (Task 2.4) |
| `handleMessageError` new import of `KaneoClassifiedError` creates circular dependency                                | Low         | Medium | Check import graph before merging; `llm-orchestrator` → `providers/kaneo/classify-error` should be acyclic                                                |
| YouTrack provider callers do not pass entity ID context (Task 1.3)                                                   | Medium      | Low    | YouTrack callers are fewer; grep for all `classifyYouTrackError` call sites and update all together                                                       |
| `ProviderError` discriminated union change (`status-not-found`, `invalid-response`) requires exhaustive switch fixes | Medium      | Medium | Run `tsc --noEmit` after each type change to surface missing cases; `getUserMessage` switch must be updated                                               |
| Logging PII: `log.error({ error })` where `error` contains user task content                                         | Low         | High   | Log only `error.message` (string), `error.code`, and `userId` — never log full task objects or user text                                                  |

---

## Resource Requirements

- **Development Hours**: ~12h total (±3h)
  - Batch A: 1h
  - Batch B: 5h
  - Batch C: 1.5h
  - Batch D: 5h (tests are the heaviest investment)
- **Skills Required**: TypeScript, discriminated union patterns, pino logging, bun:test
- **External Dependencies**: None — all capabilities are available in existing packages
- **Testing Requirements**: Unit tests for each changed module; no E2E test changes required for this phase

---

## Quality Gates

### Pre-merge checklist for each batch

- [ ] `bun run typecheck` passes with zero errors
- [ ] `bun run test` passes — no regressions
- [ ] `bun run lint` passes — no oxlint violations, no `eslint-disable`, no `@ts-ignore`
- [ ] New test file(s) exist for every changed source file
- [ ] `getUserMessage` switch coverage: all new `ProviderError` codes have a corresponding message branch
- [ ] No sensitive data (`apiKey`, `token`, `password`, message content) appears in `log.error` calls
- [ ] `handleMessageError` in `llm-orchestrator.ts` no longer uses `_userId` (underscore prefix removed)

### Acceptance test checklist (manual scenario simulation)

- [ ] **Story 1**: Mock provider throwing `KaneoClassifiedError` with `providerError.taskNotFound('T-42')` → user sees `Task "T-42" was not found.`
- [ ] **Story 2**: Mock `listColumns` returning `['To Do', 'In Progress', 'Done']`, call `validateStatus(config, pid, 'Review')` → user sees `Status "Review" is not recognised. Available statuses: To Do, In Progress, Done.`
- [ ] **Story 3**: Mock `fetch` throwing `TypeError('fetch failed')` → user sees a message containing "unavailable" or "connection"
- [ ] **Story 4**: Mock `fetch` returning `{ invalid: true }` (schema mismatch) → user sees "unexpected response" (not internal API path)
- [ ] **Story 5**: Trigger any error → `pino` log entry contains `userId`, `scope`, and error code — no API keys
- [ ] **Story 6**: `handleMessageError` called with `KaneoClassifiedError` → `reply.text` receives user-facing message, NOT "An unexpected error occurred"

---

## Out of Scope (Phase 01)

- Adding new tool capabilities or task tracker integrations
- Changing the LLM model configuration
- UI/formatting changes to success messages
- Database schema changes
- YouTrack-specific status validation (YouTrack does not have `validateStatus` equivalent today)
- Retry logic or circuit-breaker patterns (Phase 03+)
