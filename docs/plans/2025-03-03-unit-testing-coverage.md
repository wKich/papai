# Unit Testing Coverage Implementation Plan (Updated)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Also use functional-typescript for all test code.

**Goal:** Achieve comprehensive unit test coverage for the modularized papai codebase using Test-Driven Development principles.

**Architecture:** Tests will mirror the source structure using the pattern `*.test.ts` alongside source files. Each module will be tested in isolation with dependencies mocked appropriately. Tests follow the Red-Green-Refactor cycle with Bun's built-in test runner.

**Tech Stack:**

- Bun test runner (built-in, no additional dependencies needed)
- TypeScript with strict mode
- Functional programming patterns (immutable data, pure functions)

**Project Structure:**

```
src/
├── errors.ts                    # Discriminated union error types
├── config.ts                    # SQLite-backed config store
├── logger.ts                    # Pino logger configuration
├── bot.ts                       # Grammy bot + LLM orchestration
├── index.ts                     # Entry point
├── linear/
│   ├── classify-error.ts        # Shared error classifier
│   ├── create-issue.ts          # Create Linear issue
│   ├── update-issue.ts          # Update Linear issue (+ helpers)
│   ├── search-issues.ts         # Search Linear issues
│   ├── list-projects.ts         # List teams and projects
│   ├── add-comment.ts           # Add comment to issue
│   ├── get-comments.ts          # Get issue comments
│   ├── list-labels.ts           # List team labels
│   ├── get-issue-labels.ts      # Get issue labels
│   ├── create-relation.ts       # Create issue relation
│   ├── get-relations.ts         # Get issue relations
│   ├── get-issue.ts             # Get single issue details
│   ├── create-label.ts          # Create team label
│   ├── create-project.ts        # Create team project
│   └── index.ts                 # Re-exports
└── tools/
    ├── create-issue.ts          # create_issue tool factory
    ├── update-issue.ts          # update_issue tool factory
    ├── search-issues.ts         # search_issues tool factory
    ├── list-projects.ts         # list_projects tool factory
    ├── add-comment.ts           # add_comment tool factory
    ├── get-comments.ts          # get_comments tool factory
    ├── list-labels.ts           # list_labels tool factory
    ├── get-issue-labels.ts       # get_issue_labels tool factory
    ├── create-relation.ts        # create_relation tool factory
    ├── get-relations.ts         # get_relations tool factory
    ├── get-issue.ts             # get_issue tool factory
    ├── create-label.ts          # create_label tool factory
    ├── create-project.ts        # create_project tool factory
    └── index.ts                 # Assembles all tools
```

---

## Phase 1: Foundation Modules (errors, logger, config)

**Priority:** HIGH (no dependencies, required by all other modules)

### Task 1.1: Test errors.ts

**Files:**

- Create: `src/errors.test.ts`

**Testing Plan:**

```typescript
// src/errors.test.ts
import { describe, expect, test } from 'bun:test'
import { linearError, llmError, validationError, systemError, isAppError, getUserMessage } from './errors.js'

describe('Error constructors', () => {
  describe('linearError', () => {
    test('issueNotFound creates correct structure', () => {
      const error = linearError.issueNotFound('ISS-123')
      expect(error).toEqual({
        type: 'linear',
        code: 'issue-not-found',
        issueId: 'ISS-123',
      })
    })

    test('teamNotFound creates correct structure', () => {
      const error = linearError.teamNotFound('TEAM-456')
      expect(error).toEqual({
        type: 'linear',
        code: 'team-not-found',
        teamId: 'TEAM-456',
      })
    })

    test('authFailed creates correct structure', () => {
      const error = linearError.authFailed()
      expect(error).toEqual({
        type: 'linear',
        code: 'auth-failed',
      })
    })

    test('rateLimited creates correct structure', () => {
      const error = linearError.rateLimited()
      expect(error).toEqual({
        type: 'linear',
        code: 'rate-limited',
      })
    })

    test('validationFailed creates correct structure', () => {
      const error = linearError.validationFailed('title', 'Title is required')
      expect(error).toEqual({
        type: 'linear',
        code: 'validation-failed',
        field: 'title',
        reason: 'Title is required',
      })
    })

    test('labelNotFound creates correct structure', () => {
      const error = linearError.labelNotFound('urgent')
      expect(error).toEqual({
        type: 'linear',
        code: 'label-not-found',
        labelName: 'urgent',
      })
    })

    test('unknown creates correct structure', () => {
      const originalError = new Error('Something went wrong')
      const error = linearError.unknown(originalError)
      expect(error.type).toBe('linear')
      expect(error.code).toBe('unknown')
      expect(error.originalError).toBe(originalError)
    })
  })

  describe('llmError', () => {
    test('apiError creates correct structure', () => {
      const error = llmError.apiError('Connection timeout')
      expect(error).toEqual({
        type: 'llm',
        code: 'api-error',
        message: 'Connection timeout',
      })
    })

    test('rateLimited creates correct structure', () => {
      const error = llmError.rateLimited()
      expect(error).toEqual({ type: 'llm', code: 'rate-limited' })
    })

    test('timeout creates correct structure', () => {
      const error = llmError.timeout()
      expect(error).toEqual({ type: 'llm', code: 'timeout' })
    })

    test('tokenLimit creates correct structure', () => {
      const error = llmError.tokenLimit()
      expect(error).toEqual({ type: 'llm', code: 'token-limit' })
    })
  })

  describe('validationError', () => {
    test('invalidInput creates correct structure', () => {
      const error = validationError.invalidInput('email', 'Invalid format')
      expect(error).toEqual({
        type: 'validation',
        code: 'invalid-input',
        field: 'email',
        reason: 'Invalid format',
      })
    })

    test('missingRequired creates correct structure', () => {
      const error = validationError.missingRequired('api_key')
      expect(error).toEqual({
        type: 'validation',
        code: 'missing-required',
        field: 'api_key',
      })
    })
  })

  describe('systemError', () => {
    test('configMissing creates correct structure', () => {
      const error = systemError.configMissing('LINEAR_API_KEY')
      expect(error).toEqual({
        type: 'system',
        code: 'config-missing',
        variable: 'LINEAR_API_KEY',
      })
    })

    test('networkError creates correct structure', () => {
      const error = systemError.networkError('Connection refused')
      expect(error).toEqual({
        type: 'system',
        code: 'network-error',
        message: 'Connection refused',
      })
    })

    test('unexpected creates correct structure', () => {
      const originalError = new Error('Unexpected failure')
      const error = systemError.unexpected(originalError)
      expect(error.type).toBe('system')
      expect(error.code).toBe('unexpected')
      expect(error.originalError).toBe(originalError)
    })
  })
})

describe('isAppError type guard', () => {
  test('returns true for all valid error types', () => {
    expect(isAppError(linearError.authFailed())).toBe(true)
    expect(isAppError(llmError.timeout())).toBe(true)
    expect(isAppError(validationError.missingRequired('field'))).toBe(true)
    expect(isAppError(systemError.configMissing('VAR'))).toBe(true)
  })

  test('returns false for non-AppError values', () => {
    expect(isAppError(new Error('test'))).toBe(false)
    expect(isAppError(null)).toBe(false)
    expect(isAppError(undefined)).toBe(false)
    expect(isAppError('error')).toBe(false)
    expect(isAppError(42)).toBe(false)
    expect(isAppError({})).toBe(false)
    expect(isAppError({ code: 'error' })).toBe(false)
    expect(isAppError({ type: 'invalid' })).toBe(false)
  })
})

describe('getUserMessage', () => {
  describe('linear errors', () => {
    test('returns appropriate message for each error code', () => {
      expect(getUserMessage(linearError.issueNotFound('ABC-123'))).toContain('ABC-123')
      expect(getUserMessage(linearError.teamNotFound('TEAM-1'))).toContain('Team configuration')
      expect(getUserMessage(linearError.authFailed())).toContain('Failed to connect')
      expect(getUserMessage(linearError.rateLimited())).toContain('rate limit')
      expect(getUserMessage(linearError.validationFailed('title', 'too short'))).toContain('title')
      expect(getUserMessage(linearError.labelNotFound('bug'))).toContain('bug')
      expect(getUserMessage(linearError.unknown(new Error('test')))).toContain('error occurred')
    })
  })

  describe('llm errors', () => {
    test('returns appropriate message for each error code', () => {
      expect(getUserMessage(llmError.apiError('timeout'))).toContain('timeout')
      expect(getUserMessage(llmError.rateLimited())).toContain('rate limit')
      expect(getUserMessage(llmError.timeout())).toContain('timed out')
      expect(getUserMessage(llmError.tokenLimit())).toContain('too long')
    })
  })

  describe('validation errors', () => {
    test('returns appropriate message for each error code', () => {
      expect(getUserMessage(validationError.invalidInput('email', 'bad'))).toContain('email')
      expect(getUserMessage(validationError.missingRequired('name'))).toContain('name')
    })
  })

  describe('system errors', () => {
    test('returns appropriate message for each error code', () => {
      expect(getUserMessage(systemError.configMissing('API_KEY'))).toContain('API_KEY')
      expect(getUserMessage(systemError.networkError('timeout'))).toContain('timeout')
      expect(getUserMessage(systemError.unexpected(new Error('oops')))).toContain('unexpected')
    })
  })
})
```

**Step 2: Run and commit**

```bash
bun test src/errors.test.ts
git add src/errors.test.ts
git commit -m "test: add comprehensive unit tests for errors module"
```

### Task 1.2: Test logger.ts

**Files:**

- Create: `src/logger.test.ts`

```typescript
// src/logger.test.ts
import { describe, expect, test, beforeEach, afterEach } from 'bun:test'

describe('logger', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('log level configuration', () => {
    test('uses info level by default', () => {
      delete process.env.LOG_LEVEL
      const { logger } = require('./logger.js')
      expect(logger.level).toBe('info')
    })

    test('uses LOG_LEVEL from environment', () => {
      process.env.LOG_LEVEL = 'debug'
      const { logger } = require('./logger.js')
      expect(logger.level).toBe('debug')
    })

    test('handles uppercase log level', () => {
      process.env.LOG_LEVEL = 'DEBUG'
      const { logger } = require('./logger.js')
      expect(logger.level).toBe('debug')
    })

    test('handles all valid log levels', () => {
      const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']
      validLevels.forEach((level) => {
        process.env.LOG_LEVEL = level
        const { logger } = require('./logger.js')
        expect(logger.level).toBe(level)
      })
    })

    test('falls back to info for invalid log level', () => {
      process.env.LOG_LEVEL = 'invalid'
      const { logger } = require('./logger.js')
      expect(logger.level).toBe('info')
    })

    test('falls back to info for empty string', () => {
      process.env.LOG_LEVEL = ''
      const { logger } = require('./logger.js')
      expect(logger.level).toBe('info')
    })
  })

  describe('logger methods', () => {
    test('has all required log methods', () => {
      const { logger } = require('./logger.js')
      expect(typeof logger.trace).toBe('function')
      expect(typeof logger.debug).toBe('function')
      expect(typeof logger.info).toBe('function')
      expect(typeof logger.warn).toBe('function')
      expect(typeof logger.error).toBe('function')
      expect(typeof logger.fatal).toBe('function')
    })
  })
})
```

**Step 3: Commit**

```bash
git add src/logger.test.ts
git commit -m "test: add unit tests for logger configuration"
```

### Task 1.3: Test config.ts

**Files:**

- Create: `src/config.test.ts`

**Note:** This module uses SQLite. Tests should use an in-memory database or mock.

```typescript
// src/config.test.ts
import { describe, expect, test, beforeEach } from 'bun:test'
import type { ConfigKey } from './config.js'

describe('config module', () => {
  let config: typeof import('./config.js')

  beforeEach(async () => {
    // Import fresh module for isolation
    config = await import('./config.js')
  })

  describe('setConfig', () => {
    test('stores value for key', () => {
      config.setConfig('linear_key', 'test-api-key')
      expect(config.getConfig('linear_key')).toBe('test-api-key')
    })

    test('updates existing value', () => {
      config.setConfig('linear_key', 'old-key')
      config.setConfig('linear_key', 'new-key')
      expect(config.getConfig('linear_key')).toBe('new-key')
    })

    test('handles all config keys', () => {
      const testValues: Record<ConfigKey, string> = {
        linear_key: 'linear-test',
        linear_team_id: 'team-123',
        openai_key: 'openai-test',
        openai_base_url: 'https://api.openai.com',
        openai_model: 'gpt-4',
      }

      Object.entries(testValues).forEach(([key, value]) => {
        config.setConfig(key as ConfigKey, value)
        expect(config.getConfig(key as ConfigKey)).toBe(value)
      })
    })
  })

  describe('getConfig', () => {
    test('returns null for unset key', () => {
      expect(config.getConfig('openai_model')).toBeNull()
    })

    test('returns stored value', () => {
      config.setConfig('linear_team_id', 'team-abc')
      expect(config.getConfig('linear_team_id')).toBe('team-abc')
    })
  })

  describe('isConfigKey', () => {
    test('returns true for valid keys', () => {
      const validKeys: ConfigKey[] = ['linear_key', 'linear_team_id', 'openai_key', 'openai_base_url', 'openai_model']
      validKeys.forEach((key) => {
        expect(config.isConfigKey(key)).toBe(true)
      })
    })

    test('returns false for invalid keys', () => {
      const invalidKeys = ['invalid', 'linear', 'openai', 'token', '']
      invalidKeys.forEach((key) => {
        expect(config.isConfigKey(key)).toBe(false)
      })
    })

    test('returns false for non-string values', () => {
      expect(config.isConfigKey(123 as unknown as string)).toBe(false)
      expect(config.isConfigKey(null as unknown as string)).toBe(false)
      expect(config.isConfigKey(undefined as unknown as string)).toBe(false)
    })
  })

  describe('getAllConfig', () => {
    test('returns empty object when no config set', () => {
      expect(Object.keys(config.getAllConfig())).toHaveLength(0)
    })

    test('returns all set configs', () => {
      config.setConfig('linear_key', 'key-1')
      config.setConfig('openai_model', 'gpt-4')
      const allConfig = config.getAllConfig()
      expect(allConfig.linear_key).toBe('key-1')
      expect(allConfig.openai_model).toBe('gpt-4')
      expect(allConfig.linear_team_id).toBeUndefined()
    })
  })

  describe('maskValue', () => {
    test('masks sensitive keys', () => {
      expect(config.maskValue('linear_key', 'secret-key-1234')).toBe('****1234')
      expect(config.maskValue('openai_key', 'sk-abc123')).toBe('****bc123')
    })

    test('returns unmasked value for non-sensitive keys', () => {
      expect(config.maskValue('linear_team_id', 'team-123')).toBe('team-123')
      expect(config.maskValue('openai_model', 'gpt-4')).toBe('gpt-4')
      expect(config.maskValue('openai_base_url', 'https://api.openai.com')).toBe('https://api.openai.com')
    })

    test('handles short values for sensitive keys', () => {
      expect(config.maskValue('linear_key', 'ab')).toBe('****ab')
      expect(config.maskValue('linear_key', '')).toBe('****')
    })
  })

  describe('CONFIG_KEYS', () => {
    test('contains all expected keys', () => {
      expect(config.CONFIG_KEYS).toContain('linear_key')
      expect(config.CONFIG_KEYS).toContain('linear_team_id')
      expect(config.CONFIG_KEYS).toContain('openai_key')
      expect(config.CONFIG_KEYS).toContain('openai_base_url')
      expect(config.CONFIG_KEYS).toContain('openai_model')
    })

    test('has correct length', () => {
      expect(config.CONFIG_KEYS).toHaveLength(5)
    })
  })
})
```

**Step 4: Commit**

```bash
git add src/config.test.ts
git commit -m "test: add unit tests for config module with SQLite"
```

---

## Phase 2: Linear API Module Tests

**Priority:** HIGH (core business logic, 14 files to test)

### Task 2.1: Test linear/classify-error.ts

**Files:**

- Create: `src/linear/classify-error.test.ts`

```typescript
// src/linear/classify-error.test.ts
import { describe, expect, test } from 'bun:test'
import { LinearApiError, classifyLinearError } from './classify-error.js'

describe('LinearApiError', () => {
  test('extends Error with appError property', () => {
    const appError = { type: 'linear', code: 'auth-failed' } as const
    const error = new LinearApiError('Auth failed', appError)

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('Auth failed')
    expect(error.appError).toBe(appError)
    expect(error.name).toBe('LinearApiError')
  })
})

describe('classifyLinearError', () => {
  test('classifies not found errors', () => {
    const error = classifyLinearError(new Error('Issue not found'))
    expect(error).toBeInstanceOf(LinearApiError)
    expect(error.appError.code).toBe('issue-not-found')
  })

  test('classifies resource not found errors', () => {
    const error = classifyLinearError(new Error('Resource not found'))
    expect(error.appError.code).toBe('issue-not-found')
  })

  test('classifies authentication errors', () => {
    const error = classifyLinearError(new Error('Authentication failed'))
    expect(error.appError.code).toBe('auth-failed')
  })

  test('classifies unauthorized errors', () => {
    const error = classifyLinearError(new Error('Unauthorized'))
    expect(error.appError.code).toBe('auth-failed')
  })

  test('classifies rate limit errors', () => {
    const error = classifyLinearError(new Error('Rate limit exceeded'))
    expect(error.appError.code).toBe('rate-limited')
  })

  test('classifies 429 status code', () => {
    const error = classifyLinearError(new Error('429 Too Many Requests'))
    expect(error.appError.code).toBe('rate-limited')
  })

  test('classifies validation errors', () => {
    const error = classifyLinearError(new Error('Validation failed'))
    expect(error.appError.code).toBe('validation-failed')
  })

  test('classifies invalid input errors', () => {
    const error = classifyLinearError(new Error('Invalid field'))
    expect(error.appError.code).toBe('validation-failed')
  })

  test('wraps unknown errors as unexpected', () => {
    const original = new Error('Something else')
    const error = classifyLinearError(original)
    expect(error.appError.type).toBe('system')
    expect(error.appError.code).toBe('unexpected')
  })

  test('handles non-Error values', () => {
    const error = classifyLinearError('string error')
    expect(error).toBeInstanceOf(LinearApiError)
    expect(error.message).toBe('string error')
  })

  test('handles null/undefined', () => {
    const error = classifyLinearError(null)
    expect(error).toBeInstanceOf(LinearApiError)
    expect(error.message).toBe('null')
  })
})
```

**Step 2: Commit**

```bash
git add src/linear/classify-error.test.ts
git commit -m "test: add unit tests for linear error classifier"
```

### Task 2.2: Test linear/create-issue.ts

**Files:**

- Create: `src/linear/create-issue.test.ts`

```typescript
// src/linear/create-issue.test.ts
import { describe, expect, test, beforeEach, mock } from 'bun:test'
import { createIssue } from './create-issue.js'

// Mock Linear SDK
mock.module('@linear/sdk', () => ({
  LinearClient: class MockLinearClient {
    constructor(public config: { apiKey: string }) {}

    async createIssue(input: unknown) {
      return {
        issue: Promise.resolve({
          id: 'issue-123',
          identifier: 'TEAM-1',
          title: (input as { title: string }).title,
          priority: (input as { priority?: number }).priority ?? 0,
          url: 'https://linear.app/issue/TEAM-1',
        }),
      }
    }
  },
}))

describe('createIssue', () => {
  const mockApiKey = 'test-api-key'

  test('creates issue with minimal parameters', async () => {
    const result = await createIssue({
      apiKey: mockApiKey,
      title: 'Test Issue',
      teamId: 'team-123',
    })

    expect(result).toBeDefined()
    expect(result?.id).toBe('issue-123')
    expect(result?.identifier).toBe('TEAM-1')
  })

  test('creates issue with all parameters', async () => {
    const result = await createIssue({
      apiKey: mockApiKey,
      title: 'Full Test Issue',
      description: 'A detailed description',
      priority: 1,
      projectId: 'proj-456',
      teamId: 'team-123',
      dueDate: '2025-03-15',
      labelIds: ['label-1', 'label-2'],
      estimate: 5,
    })

    expect(result).toBeDefined()
    expect(result?.priority).toBe(1)
  })

  test('handles optional parameters', async () => {
    const result = await createIssue({
      apiKey: mockApiKey,
      title: 'Minimal Issue',
      teamId: 'team-123',
    })

    expect(result).toBeDefined()
  })

  test('returns undefined when API returns no issue', async () => {
    // Override mock to return null issue
    mock.module('@linear/sdk', () => ({
      LinearClient: class MockLinearClient {
        async createIssue() {
          return { issue: Promise.resolve(null) }
        }
      },
    }))

    const result = await createIssue({
      apiKey: mockApiKey,
      title: 'Test',
      teamId: 'team-123',
    })

    expect(result).toBeNull()
  })

  test('throws LinearApiError on API failure', async () => {
    mock.module('@linear/sdk', () => ({
      LinearClient: class MockLinearClient {
        async createIssue() {
          throw new Error('Authentication failed')
        }
      },
    }))

    await expect(createIssue({ apiKey: 'invalid', title: 'Test', teamId: 'team-123' })).rejects.toThrow(
      'LinearApiError',
    )
  })
})
```

### Task 2.3: Test linear/update-issue.ts

**Files:**

- Create: `src/linear/update-issue.test.ts`

**Note:** This file exports `updateIssue` and has internal helper functions `resolveWorkflowState` and `buildUpdateInput` that should be tested.

```typescript
// src/linear/update-issue.test.ts
import { describe, expect, test, mock } from 'bun:test'
import { updateIssue } from './update-issue.js'

// Mock Linear SDK with state resolution
describe('updateIssue', () => {
  const mockApiKey = 'test-api-key'

  beforeEach(() => {
    mock.module('@linear/sdk', () => ({
      LinearClient: class MockLinearClient {
        async issue(issueId: string) {
          return {
            team: Promise.resolve({
              states: async () => ({
                nodes: [
                  { id: 'state-1', name: 'Todo' },
                  { id: 'state-2', name: 'In Progress' },
                  { id: 'state-3', name: 'Done' },
                ],
              }),
            }),
          }
        }

        async updateIssue(issueId: string, input: unknown) {
          return {
            issue: Promise.resolve({
              id: issueId,
              identifier: 'TEAM-1',
              title: 'Updated Issue',
              ...input,
            }),
          }
        }
      },
    }))
  })

  test('updates issue status', async () => {
    const result = await updateIssue({
      apiKey: mockApiKey,
      issueId: 'issue-123',
      status: 'In Progress',
    })

    expect(result).toBeDefined()
  })

  test('updates issue assignee', async () => {
    const result = await updateIssue({
      apiKey: mockApiKey,
      issueId: 'issue-123',
      assigneeId: 'user-456',
    })

    expect(result).toBeDefined()
  })

  test('updates multiple fields at once', async () => {
    const result = await updateIssue({
      apiKey: mockApiKey,
      issueId: 'issue-123',
      status: 'Done',
      assigneeId: 'user-789',
      dueDate: '2025-03-20',
      estimate: 8,
    })

    expect(result).toBeDefined()
  })

  test('handles unknown workflow state gracefully', async () => {
    const result = await updateIssue({
      apiKey: mockApiKey,
      issueId: 'issue-123',
      status: 'NonExistentState',
    })

    expect(result).toBeDefined()
  })

  test('handles case-insensitive state matching', async () => {
    const result = await updateIssue({
      apiKey: mockApiKey,
      issueId: 'issue-123',
      status: 'in progress', // lowercase
    })

    expect(result).toBeDefined()
  })

  test('throws LinearApiError on API failure', async () => {
    mock.module('@linear/sdk', () => ({
      LinearClient: class MockLinearClient {
        async issue() {
          throw new Error('Issue not found')
        }
      },
    }))

    await expect(updateIssue({ apiKey: mockApiKey, issueId: 'invalid' })).rejects.toThrow('LinearApiError')
  })
})
```

### Task 2.4-2.14: Test remaining Linear modules

For each of the remaining 11 Linear modules, create corresponding test files:

1. `src/linear/search-issues.test.ts`
2. `src/linear/list-projects.test.ts`
3. `src/linear/add-comment.test.ts`
4. `src/linear/get-comments.test.ts`
5. `src/linear/list-labels.test.ts`
6. `src/linear/get-issue-labels.test.ts`
7. `src/linear/create-relation.test.ts`
8. `src/linear/get-relations.test.ts`
9. `src/linear/get-issue.test.ts`
10. `src/linear/create-label.test.ts`
11. `src/linear/create-project.test.ts`

Each test file should cover:

- Happy path with valid inputs
- Optional parameter handling
- Edge cases (null returns, empty arrays, etc.)
- Error handling via classifyLinearError
- API failure scenarios

**Step 15: Commit all Linear tests**

```bash
git add src/linear/*.test.ts
git commit -m "test: add unit tests for all Linear API modules"
```

---

## Phase 3: Tool Factory Tests

**Priority:** MEDIUM (13 tool factory functions)

### Task 3.1: Test tools/create-issue.ts

**Files:**

- Create: `src/tools/create-issue.test.ts`

```typescript
// src/tools/create-issue.test.ts
import { describe, expect, test, mock, beforeEach } from 'bun:test'
import { makeCreateIssueTool } from './create-issue.js'

// Mock dependencies
mock.module('../linear/index.js', () => ({
  createIssue: mock(async () => ({
    id: 'issue-123',
    identifier: 'TEAM-1',
    title: 'Created Issue',
    url: 'https://linear.app/issue/TEAM-1',
  })),
}))

describe('makeCreateIssueTool', () => {
  const linearKey = 'test-key'
  const linearTeamId = 'team-123'
  let tool: ReturnType<typeof makeCreateIssueTool>

  beforeEach(() => {
    tool = makeCreateIssueTool(linearKey, linearTeamId)
  })

  test('returns tool with required properties', () => {
    expect(tool).toHaveProperty('description')
    expect(tool).toHaveProperty('inputSchema')
    expect(tool).toHaveProperty('execute')
    expect(typeof tool.execute).toBe('function')
  })

  test('executes with valid input', async () => {
    const result = await tool.execute({
      title: 'Test Issue',
      description: 'A test issue',
      priority: 1,
    })

    expect(result).toHaveProperty('id', 'issue-123')
    expect(result).toHaveProperty('identifier', 'TEAM-1')
    expect(result).toHaveProperty('title', 'Created Issue')
    expect(result).toHaveProperty('url')
  })

  test('validates required title field', async () => {
    await expect(tool.execute({ description: 'Missing title' })).rejects.toThrow()
  })

  test('validates priority range (0-4)', async () => {
    await expect(tool.execute({ title: 'Test', priority: 5 })).rejects.toThrow()

    await expect(tool.execute({ title: 'Test', priority: -1 })).rejects.toThrow()
  })

  test('handles optional fields', async () => {
    const result = await tool.execute({ title: 'Minimal Issue' })
    expect(result).toBeDefined()
  })

  test('validates dueDate format', async () => {
    // Should accept ISO 8601 format
    const result = await tool.execute({
      title: 'Test',
      dueDate: '2025-03-15',
    })
    expect(result).toBeDefined()
  })

  test('validates labelIds is array', async () => {
    await expect(
      // @ts-expect-error Testing invalid input
      tool.execute({ title: 'Test', labelIds: 'not-an-array' }),
    ).rejects.toThrow()
  })

  test('validates estimate is integer', async () => {
    await expect(tool.execute({ title: 'Test', estimate: 3.5 })).rejects.toThrow()
  })

  test('returns partial data when API returns incomplete', async () => {
    mock.module('../linear/index.js', () => ({
      createIssue: mock(async () => null),
    }))

    const result = await tool.execute({ title: 'Test' })
    expect(result).toEqual({
      id: undefined,
      identifier: undefined,
      title: undefined,
      url: undefined,
    })
  })

  test('throws on Linear API error', async () => {
    mock.module('../linear/index.js', () => ({
      createIssue: mock(async () => {
        throw new Error('Linear API Error')
      }),
    }))

    await expect(tool.execute({ title: 'Test' })).rejects.toThrow()
  })
})
```

### Task 3.2-3.13: Test remaining tool factories

For each tool factory, create test files:

1. `src/tools/update-issue.test.ts`
2. `src/tools/search-issues.test.ts`
3. `src/tools/list-projects.test.ts`
4. `src/tools/add-comment.test.ts`
5. `src/tools/get-comments.test.ts`
6. `src/tools/list-labels.test.ts`
7. `src/tools/get-issue-labels.test.ts`
8. `src/tools/create-relation.test.ts`
9. `src/tools/get-relations.test.ts`
10. `src/tools/get-issue.test.ts`
11. `src/tools/create-label.test.ts`
12. `src/tools/create-project.test.ts`

### Task 3.14: Test tools/index.ts

**Files:**

- Create: `src/tools/index.test.ts`

```typescript
// src/tools/index.test.ts
import { describe, expect, test } from 'bun:test'
import { makeTools } from './index.js'

describe('makeTools', () => {
  const config = {
    linearKey: 'test-key',
    linearTeamId: 'team-123',
  }

  test('returns object with all 13 tools', () => {
    const tools = makeTools(config)

    expect(tools).toHaveProperty('create_issue')
    expect(tools).toHaveProperty('update_issue')
    expect(tools).toHaveProperty('search_issues')
    expect(tools).toHaveProperty('list_projects')
    expect(tools).toHaveProperty('add_comment')
    expect(tools).toHaveProperty('get_comments')
    expect(tools).toHaveProperty('list_labels')
    expect(tools).toHaveProperty('get_issue_labels')
    expect(tools).toHaveProperty('create_relation')
    expect(tools).toHaveProperty('get_relations')
    expect(tools).toHaveProperty('get_issue')
    expect(tools).toHaveProperty('create_label')
    expect(tools).toHaveProperty('create_project')
  })

  test('each tool has required properties', () => {
    const tools = makeTools(config)

    Object.values(tools).forEach((tool) => {
      expect(tool).toHaveProperty('description')
      expect(tool).toHaveProperty('inputSchema')
      expect(tool).toHaveProperty('execute')
      expect(typeof tool.execute).toBe('function')
    })
  })

  test('passes linearKey to tools that need it', () => {
    const tools = makeTools(config)
    // Tools should be callable - this tests the factory executed correctly
    expect(typeof tools.create_issue.execute).toBe('function')
  })
})
```

**Step 15: Commit all tool tests**

```bash
git add src/tools/*.test.ts
git commit -m "test: add unit tests for all tool factories"
```

---

## Phase 4: Bot Module Tests

**Priority:** MEDIUM (complex integration with multiple dependencies)

### Task 4.1: Test bot.ts

**Files:**

- Create: `src/bot.test.ts`

```typescript
// src/bot.test.ts
import { describe, expect, test, mock, beforeEach } from 'bun:test'

// Set up environment before importing bot
process.env.TELEGRAM_BOT_TOKEN = 'test-token'
process.env.TELEGRAM_USER_ID = '123456'

// Mock all dependencies before importing bot
mock.module('grammy', () => ({
  Bot: class MockBot {
    commands = new Map()
    handlers = new Map()

    command(name: string, handler: Function) {
      this.commands.set(name, handler)
    }

    on(event: string, handler: Function) {
      this.handlers.set(event, handler)
    }

    start = mock(async () => {})
  },
}))

mock.module('./config.js', () => ({
  CONFIG_KEYS: ['linear_key', 'linear_team_id', 'openai_key', 'openai_base_url', 'openai_model'],
  getConfig: mock((key: string) => {
    const configs: Record<string, string | null> = {
      openai_key: 'test-openai-key',
      linear_key: 'test-linear-key',
      linear_team_id: 'team-123',
    }
    return configs[key] ?? null
  }),
  setConfig: mock(() => {}),
  getAllConfig: mock(() => ({
    linear_key: 'test-linear-key',
    linear_team_id: 'team-123',
  })),
  isConfigKey: mock((key: string) => ['linear_key', 'linear_team_id', 'openai_key'].includes(key)),
  maskValue: mock((_k: string, v: string) => v),
}))

mock.module('./errors.js', () => ({
  isAppError: mock((e: unknown) => e && typeof e === 'object' && 'type' in e),
  getUserMessage: mock(() => 'Error message'),
}))

mock.module('ai', () => ({
  generateText: mock(async () => ({
    text: 'Hello! I can help you with that.',
    toolCalls: [],
    response: { messages: [{ role: 'assistant', content: 'Hello!' }] },
    usage: { promptTokens: 10, completionTokens: 5 },
  })),
  stepCountIs: (n: number) => () => false,
}))

mock.module('@ai-sdk/openai', () => ({
  createOpenAI: () => (model: string) => ({ model }),
}))

mock.module('./tools/index.js', () => ({
  makeTools: mock(() => ({})),
}))

describe('bot module', () => {
  let botModule: typeof import('./bot.js')

  beforeEach(async () => {
    botModule = await import('./bot.js')
  })

  describe('checkAuthorization', () => {
    test('returns true for authorized user', () => {
      const { checkAuthorization } = botModule
      expect(checkAuthorization(123456)).toBe(true)
    })

    test('returns false for unauthorized user', () => {
      const { checkAuthorization } = botModule
      expect(checkAuthorization(999999)).toBe(false)
    })

    test('returns false for undefined userId', () => {
      const { checkAuthorization } = botModule
      expect(checkAuthorization(undefined)).toBe(false)
    })
  })

  describe('conversation history', () => {
    const userId = 123456

    test('initializes history for new user', () => {
      const { getOrCreateHistory } = botModule
      const history = getOrCreateHistory(userId)
      expect(history).toEqual([])
    })

    test('returns existing history', () => {
      const { getOrCreateHistory } = botModule
      const first = getOrCreateHistory(userId)
      const second = getOrCreateHistory(userId)
      expect(first).toBe(second)
    })

    test('trims history over 40 messages', () => {
      const { trimHistory } = botModule
      const longHistory = Array(50).fill({ role: 'user', content: 'test' })
      const trimmed = trimHistory(longHistory, userId)
      expect(trimmed).toHaveLength(40)
    })

    test('preserves history under 40 messages', () => {
      const { trimHistory } = botModule
      const shortHistory = Array(20).fill({ role: 'user', content: 'test' })
      const trimmed = trimHistory(shortHistory, userId)
      expect(trimmed).toHaveLength(20)
    })

    test('keeps most recent messages when trimming', () => {
      const { trimHistory } = botModule
      const history = Array.from({ length: 50 }, (_, i) => ({
        role: 'user' as const,
        content: `message-${i}`,
      }))
      const trimmed = trimHistory(history, userId)
      expect(trimmed[0]?.content).toBe('message-10')
      expect(trimmed[39]?.content).toBe('message-49')
    })
  })

  describe('buildOpenAI', () => {
    test('creates client with just API key', () => {
      const { buildOpenAI } = botModule
      const client = buildOpenAI('test-key', null)
      expect(client).toBeDefined()
    })

    test('creates client with custom base URL', () => {
      const { buildOpenAI } = botModule
      const client = buildOpenAI('test-key', 'https://custom.api.com')
      expect(client).toBeDefined()
    })
  })

  describe('bot commands', () => {
    test('bot instance has set command', () => {
      const { bot } = botModule
      expect(bot.commands.has('set')).toBe(true)
    })

    test('bot instance has config command', () => {
      const { bot } = botModule
      expect(bot.commands.has('config')).toBe(true)
    })

    test('bot instance has text message handler', () => {
      const { bot } = botModule
      expect(bot.handlers.has('message:text')).toBe(true)
    })
  })
})
```

**Step 2: Commit**

```bash
git add src/bot.test.ts
git commit -m "test: add unit tests for bot module"
```

---

## Phase 5: Linear Module Index Test

**Priority:** LOW (simple re-exports)

### Task 5.1: Test linear/index.ts

**Files:**

- Create: `src/linear/index.test.ts`

```typescript
// src/linear/index.test.ts
import { describe, expect, test } from 'bun:test'
import * as linear from './index.js'

describe('linear index exports', () => {
  test('exports all 13 Linear functions', () => {
    expect(typeof linear.createIssue).toBe('function')
    expect(typeof linear.updateIssue).toBe('function')
    expect(typeof linear.searchIssues).toBe('function')
    expect(typeof linear.listProjects).toBe('function')
    expect(typeof linear.addComment).toBe('function')
    expect(typeof linear.getComments).toBe('function')
    expect(typeof linear.listLabels).toBe('function')
    expect(typeof linear.getIssueLabels).toBe('function')
    expect(typeof linear.createRelation).toBe('function')
    expect(typeof linear.getRelations).toBe('function')
    expect(typeof linear.getIssue).toBe('function')
    expect(typeof linear.createLabel).toBe('function')
    expect(typeof linear.createProject).toBe('function')
  })
})
```

**Step 2: Commit**

```bash
git add src/linear/index.test.ts
git commit -m "test: add test for linear module index exports"
```

---

## Phase 6: Integration and Coverage

**Priority:** LOW (final validation)

### Task 6.1: Update package.json

**Files:**

- Modify: `package.json`

Add test scripts:

```json
{
  "scripts": {
    "start": "bun run src/index.ts",
    "lint": "oxlint --type-aware .",
    "lint:fix": "oxlint --type-aware --fix .",
    "format": "oxfmt --write .",
    "format:check": "oxfmt --check .",
    "test": "bun test",
    "test:watch": "bun test --watch",
    "test:coverage": "bun test --coverage",
    "prepare": "cp scripts/pre-commit.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit"
  }
}
```

### Task 6.2: Run Full Test Suite

```bash
# Run all tests
bun test

# Generate coverage report
bun test --coverage
```

Expected: All tests pass, coverage report generated

### Task 6.3: Final Commit

```bash
git add package.json
git commit -m "test: add test scripts and complete unit test coverage"
```

---

## Summary

**Total Test Files:** 32

- Phase 1: 3 files (errors, logger, config)
- Phase 2: 15 files (classify-error + 13 Linear modules + index)
- Phase 3: 14 files (13 tool factories + index)
- Phase 4: 1 file (bot)

**Estimated Test Count:** 250+ tests

**Test Distribution:**
| Module | Test File | Estimated Tests |
|--------|-----------|-----------------|
| errors.ts | errors.test.ts | 25 |
| logger.ts | logger.test.ts | 10 |
| config.ts | config.test.ts | 20 |
| linear/classify-error.ts | classify-error.test.ts | 12 |
| linear/create-issue.ts | create-issue.test.ts | 8 |
| linear/update-issue.ts | update-issue.test.ts | 8 |
| linear/search-issues.ts | search-issues.test.ts | 6 |
| linear/list-projects.ts | list-projects.test.ts | 5 |
| linear/add-comment.ts | add-comment.test.ts | 5 |
| linear/get-comments.ts | get-comments.test.ts | 5 |
| linear/list-labels.ts | list-labels.test.ts | 5 |
| linear/get-issue-labels.ts | get-issue-labels.test.ts | 5 |
| linear/create-relation.ts | create-relation.test.ts | 5 |
| linear/get-relations.ts | get-relations.test.ts | 5 |
| linear/get-issue.ts | get-issue.test.ts | 6 |
| linear/create-label.ts | create-label.test.ts | 5 |
| linear/create-project.ts | create-project.test.ts | 5 |
| linear/index.ts | index.test.ts | 1 |
| tools/create-issue.ts | create-issue.test.ts | 12 |
| tools/update-issue.ts | update-issue.test.ts | 10 |
| tools/search-issues.ts | search-issues.test.ts | 8 |
| tools/list-projects.ts | list-projects.test.ts | 6 |
| tools/add-comment.ts | add-comment.test.ts | 6 |
| tools/get-comments.ts | get-comments.test.ts | 6 |
| tools/list-labels.ts | list-labels.test.ts | 6 |
| tools/get-issue-labels.ts | get-issue-labels.test.ts | 6 |
| tools/create-relation.ts | create-relation.test.ts | 6 |
| tools/get-relations.ts | get-relations.test.ts | 6 |
| tools/get-issue.ts | get-issue.test.ts | 6 |
| tools/create-label.ts | create-label.test.ts | 6 |
| tools/create-project.ts | create-project.test.ts | 6 |
| tools/index.ts | index.test.ts | 3 |
| bot.ts | bot.test.ts | 15 |

**Execution Order:**

1. Phase 1: Foundation (errors, logger, config) - No dependencies
2. Phase 2: Linear modules (classify-error first, then others) - Depends on errors/logger
3. Phase 3: Tool factories - Depends on Linear modules
4. Phase 4: Bot module - Depends on all above
5. Phase 5: Index exports - Simple verification
6. Phase 6: Integration - Full suite validation

Each phase can be implemented independently, but should follow the dependency order for clean testing.
