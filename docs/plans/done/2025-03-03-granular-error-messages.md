# Granular Error Messages Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace generic "something went wrong" error messages with specific, actionable feedback based on error type and context

**Architecture:** Create a centralized error handling system with domain-specific error types, error-to-message mappers, and context-aware error catching at each layer (Linear API, LLM, validation)

**Tech Stack:** TypeScript, pino logger, discriminated unions for error types

---

## Current State Analysis

### Error Handling Locations

1. **src/bot.ts:82-89** — Generic catch-all in `processMessage`
   - Always returns: "Sorry, something went wrong. Please try again."
   - Logs error but doesn't categorize it

2. **src/linear.ts** — No try-catch, errors bubble up as exceptions
   - Linear SDK throws on API failures
   - No user-friendly error translation

3. **src/tools.ts** — No try-catch in tool execute functions
   - Errors propagate to bot.ts handler
   - No context about which tool failed

### Error Categories Needed

1. **Linear API Errors**
   - Authentication failures (invalid API key)
   - Rate limiting
   - Issue not found (invalid issueId)
   - Team not found (invalid teamId)
   - Validation errors (invalid priority, etc.)

2. **OpenAI/LLM Errors**
   - API failures
   - Rate limiting
   - Token limit exceeded
   - Timeout

3. **Validation Errors**
   - Invalid input from user
   - Missing required fields
   - Type mismatches (Zod validation)

4. **System Errors**
   - Environment variable missing
   - Network failures
   - Unexpected errors

---

## Implementation Plan

### Task 1: Define Error Types Module

**Files:**

- Create: `src/errors.ts`

**Step 1: Create discriminated union error types**

```typescript
// Error categories using discriminated unions
type LinearError =
  | { type: 'linear'; code: 'issue-not-found'; issueId: string }
  | { type: 'linear'; code: 'team-not-found'; teamId: string }
  | { type: 'linear'; code: 'auth-failed' }
  | { type: 'linear'; code: 'rate-limited' }
  | { type: 'linear'; code: 'validation-failed'; field: string; reason: string }
  | { type: 'linear'; code: 'unknown'; originalError: Error }

type LlmError =
  | { type: 'llm'; code: 'api-error'; message: string }
  | { type: 'llm'; code: 'rate-limited' }
  | { type: 'llm'; code: 'timeout' }
  | { type: 'llm'; code: 'token-limit' }

type ValidationError =
  | { type: 'validation'; code: 'invalid-input'; field: string; reason: string }
  | { type: 'validation'; code: 'missing-required'; field: string }

type SystemError =
  | { type: 'system'; code: 'config-missing'; variable: string }
  | { type: 'system'; code: 'network-error'; message: string }
  | { type: 'system'; code: 'unexpected'; originalError: Error }

export type AppError = LinearError | LlmError | ValidationError | SystemError
```

**Step 2: Create error constructors**

```typescript
export const linearError = {
  issueNotFound: (issueId: string): AppError => ({ type: 'linear', code: 'issue-not-found', issueId }),
  teamNotFound: (teamId: string): AppError => ({ type: 'linear', code: 'team-not-found', teamId }),
  // ... etc
}

export const llmError = {
  apiError: (message: string): AppError => ({ type: 'llm', code: 'api-error', message }),
  // ... etc
}
```

**Step 3: Commit**

```bash
git add src/errors.ts
git commit -m "feat: add discriminated union error types"
```

---

### Task 2: Create Error Message Mapper

**Files:**

- Modify: `src/errors.ts` (add to end)

**Step 1: Create user-facing message mapper**

```typescript
export const getUserMessage = (error: AppError): string => {
  switch (error.type) {
    case 'linear':
      return getLinearMessage(error)
    case 'llm':
      return getLlmMessage(error)
    case 'validation':
      return getValidationMessage(error)
    case 'system':
      return getSystemMessage(error)
  }
}

const getLinearMessage = (error: LinearError): string => {
  switch (error.code) {
    case 'issue-not-found':
      return `Issue "${error.issueId}" was not found. Please check the issue ID and try again.`
    case 'team-not-found':
      return `Team configuration error. Please check LINEAR_TEAM_ID.`
    case 'auth-failed':
      return `Failed to connect to Linear. Please check your LINEAR_API_KEY.`
    case 'rate-limited':
      return `Linear API rate limit reached. Please wait a moment and try again.`
    case 'validation-failed':
      return `Invalid ${error.field}: ${error.reason}`
    case 'unknown':
      return `Linear API error occurred. Please try again later.`
  }
}

// ... similar for other error types
```

**Step 2: Commit**

```bash
git add src/errors.ts
git commit -m "feat: add user-facing error message mapper"
```

---

### Task 3: Add Linear API Error Handling

**Files:**

- Modify: `src/linear.ts`

**Step 1: Add error classification function**

```typescript
const classifyLinearError = (error: unknown): AppError => {
  if (error instanceof LinearClientError) {
    // Check specific error types from Linear SDK
    if (error.message.includes('not found')) {
      return linearError.issueNotFound('unknown')
    }
    if (error.message.includes('authentication')) {
      return linearError.authFailed()
    }
    if (error.message.includes('rate limit')) {
      return linearError.rateLimited()
    }
  }
  return systemError.unexpected(error instanceof Error ? error : new Error(String(error)))
}
```

**Step 2: Wrap createIssue with error handling**

```typescript
export async function createIssue({
  title,
  description,
  priority,
  projectId,
  teamId,
}: CreateIssueInput): Promise<LinearFetch<Issue> | undefined> {
  logger.debug(
    { title, hasDescription: description !== undefined, priority, hasProjectId: projectId !== undefined, teamId },
    'createIssue called',
  )

  try {
    const payload = await client.createIssue({
      title,
      description,
      priority,
      projectId,
      teamId,
    })
    const issue = await payload.issue
    if (issue) {
      logger.info({ issueId: issue.id, identifier: issue.identifier, title }, 'Issue created')
    }
    return payload.issue
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error), title, teamId }, 'createIssue failed')
    throw classifyLinearError(error)
  }
}
```

**Step 3: Wrap updateIssue with error handling**

```typescript
export async function updateIssue({
  issueId,
  status,
  assigneeId,
}: UpdateIssueInput): Promise<LinearFetch<Issue> | undefined> {
  logger.debug(
    { issueId, hasStatus: status !== undefined, hasAssigneeId: assigneeId !== undefined },
    'updateIssue called',
  )

  try {
    const updateInput: { stateId?: string; assigneeId?: string } = {}

    if (status !== undefined) {
      const issue = await client.issue(issueId)
      if (!issue) {
        throw linearError.issueNotFound(issueId)
      }
      // ... rest of status resolution
    }

    const payload = await client.updateIssue(issueId, updateInput)
    // ... rest
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error), issueId }, 'updateIssue failed')
    throw classifyLinearError(error)
  }
}
```

**Step 4: Commit**

```bash
git add src/linear.ts
git commit -m "feat: add error handling to Linear SDK wrappers"
```

---

### Task 4: Update Bot Error Handler

**Files:**

- Modify: `src/bot.ts`

**Step 1: Import error types and mapper**

```typescript
import { type AppError, getUserMessage, isAppError } from './errors.js'
```

**Step 2: Update error handling in processMessage**

```typescript
} catch (error) {
  history.pop()

  // Check if it's a known AppError
  if (isAppError(error)) {
    const userMessage = getUserMessage(error)
    logger.warn(
      { error: { type: error.type, code: error.code }, userId },
      `Handled error: ${error.type}/${error.code}`
    )
    await ctx.reply(userMessage)
  } else {
    // Unknown/unexpected error
    logger.error(
      { error: error instanceof Error ? error.message : String(error), userId },
      'Unexpected error generating response'
    )
    await ctx.reply('An unexpected error occurred. Please try again later.')
  }
}
```

**Step 3: Commit**

```bash
git add src/bot.ts
git commit -m "feat: update bot error handler with granular messages"
```

---

### Task 5: Add Tool-Level Error Context

**Files:**

- Modify: `src/tools.ts`

**Step 1: Wrap tool execution with context**

```typescript
execute: async ({ title, description, priority, projectId }) => {
  try {
    const teamId = process.env['LINEAR_TEAM_ID']!
    const issue = await createIssue({
      title,
      description,
      priority,
      projectId,
      teamId,
    })
    // ... rest
  } catch (error) {
    logger.error({ error, title, tool: 'create_issue' }, 'Tool execution failed')
    throw error // Re-throw for bot handler
  }
}
```

**Step 2: Commit**

```bash
git add src/tools.ts
git commit -m "feat: add error context to tool execution"
```

---

### Task 6: Update Tests (if exists)

**Files:**

- Check for: `src/**/*.test.ts` or `tests/**/*.ts`

**Step 1: Add error type tests**

```typescript
test('getUserMessage returns specific message for issue-not-found', () => {
  const error = linearError.issueNotFound('ABC-123')
  const message = getUserMessage(error)
  expect(message).toContain('ABC-123')
  expect(message).toContain('not found')
})

test('getUserMessage returns generic message for unknown linear error', () => {
  const error = linearError.unknown(new Error('network timeout'))
  const message = getUserMessage(error)
  expect(message).toBe('Linear API error occurred. Please try again later.')
})
```

**Step 2: Commit**

```bash
git add tests/errors.test.ts
git commit -m "test: add error message mapper tests"
```

---

### Task 7: Run Full Verification

**Step 1: Type check**

```bash
bun run lint
```

**Step 2: Test error scenarios manually**

1. Send message with invalid issue ID
2. Verify specific "not found" message appears
3. Check logs show full error details

**Step 3: Final commit**

```bash
git commit -m "feat: complete granular error messages implementation

- Add discriminated union error types (Linear, LLM, Validation, System)
- Add user-facing error message mapper
- Wrap Linear SDK calls with error classification
- Update bot handler to show specific messages per error type
- Log full error context for debugging
- Maintains type safety with exhaustiveness checking"
```

---

## Success Criteria

- [ ] All errors show specific, actionable messages to users
- [ ] Full error details are logged for debugging
- [ ] No generic "something went wrong" messages remain
- [ ] Type system enforces all error cases are handled
- [ ] Lint passes with 0 warnings
- [ ] No regression in existing functionality

## Future Enhancements (not in scope)

- Error metrics/counters
- Error recovery suggestions
- Error retry logic with backoff
- User-friendly error codes (e.g., "Error P-101")
