# Migration: mock.module() to spyOn() Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate from `mock.module()` to `spyOn()` to eliminate Bun's mock pollution issues where `mock.restore()` doesn't properly restore mocked modules.

**Architecture:** Introduce test-only setter/getter patterns and mutable exports that allow `spyOn()` to work on objects rather than module-level mocks. Migration is organized by module category with incremental rollout.

**Tech Stack:** Bun test runner, TypeScript, pino logger, drizzle-orm

---

## Overview

### Problem

Bun's `mock.module()` is global and permanent per process. While `mock.restore()` is supposed to restore mocks, it has known issues where module state leaks between tests, causing hard-to-debug failures.

### Solution

Replace `mock.module()` with `spyOn()` by:

1. Refactoring modules to export objects with methods that can be spied on
2. Adding test-only `_set*` and `_reset*` functions for singletons
3. Creating mutable export objects for external libraries

### Current State

- 29 files using `mock.module()`
- 53 total `mock.module()` calls
- Categories: Database (~14), External libs (~7), Internal modules (~8)

### Progress Update (2026-04-01)

#### Completed Tasks ✅

| Task                                                   | Status      | Commit    |
| ------------------------------------------------------ | ----------- | --------- |
| Task 1: Add test-only setters to db/index.ts           | ✅ Complete | `9a37983` |
| Task 2: Update test helper mockDrizzle() documentation | ✅ Complete | `fec9f56` |
| Task 3: Add mockLoggerSpy() helper using spyOn         | ✅ Complete | `831b062` |
| Task 4: Create ai-wrapper.ts                           | ✅ Complete | `4c12665` |
| Task 5: Create ai-sdk-wrapper.ts                       | ✅ Complete | `4c12665` |
| Task 6: Update conversation.ts to use ai-wrapper       | ✅ Complete | `4c12665` |
| Task 7: Update llm-orchestrator.ts to use wrappers     | ✅ Complete | `4c12665` |
| Task 8: Update memory.test.ts to use spyOn             | ✅ Complete | `4c12665` |
| Task 9: Update conversation.test.ts to use spyOn       | ✅ Complete | `4c12665` |

#### Test Results

- **1798 tests passing**
- **10 tests failing** (pre-existing wizard engine issues unrelated to migration)
- **12 wrapper tests passing** (8 ai-wrapper + 4 ai-sdk-wrapper)

#### Files Changed

- `src/db/index.ts` - Added `_setMigrationDb` and `_resetMigrationDb`
- `src/lib/ai-wrapper.ts` - New wrapper for 'ai' library
- `src/lib/ai-sdk-wrapper.ts` - New wrapper for '@ai-sdk/openai-compatible'
- `src/conversation.ts` - Updated imports to use wrappers
- `src/llm-orchestrator.ts` - Updated imports to use wrappers
- `src/memory.ts` - Updated imports to use wrappers
- `tests/utils/test-helpers.ts` - Added spyOn documentation and mockLoggerSpy helper
- `tests/CLAUDE.md` - Updated mocking documentation
- `tests/memory.test.ts` - Migrated from mock.module to spyOn
- `tests/conversation.test.ts` - Migrated from mock.module to spyOn
- `tests/lib/ai-wrapper.test.ts` - New tests for ai-wrapper
- `tests/lib/ai-sdk-wrapper.test.ts` - New tests for ai-sdk-wrapper

#### Remaining Tasks

| Task                                                                   | Priority | Status  |
| ---------------------------------------------------------------------- | -------- | ------- |
| Task 10-12: Refactor internal modules (recurring, scheduler, registry) | Medium   | Pending |
| Task 13: Batch update remaining test files                             | Low      | Pending |
| Task 14: Deprecate mock.module() helpers                               | Low      | Pending |
| Task 15: Update find-mock-modules.ts script                            | Low      | Pending |
| Task 16: Final verification                                            | High     | Pending |

---

## Module Categories

### Category A: Database Modules (High Priority)

Files: `src/db/drizzle.ts`, `src/db/index.ts`
Pattern: Singleton with test setters

### Category B: Logger Module (High Priority)

File: `src/logger.ts`
Pattern: Mutable logger instance export

### Category C: External Libraries (Medium Priority)

Libraries: `ai`, `@ai-sdk/openai-compatible`
Pattern: Create wrapper modules with mutable exports

### Category D: Internal Business Logic (Medium Priority)

Files: `src/recurring.js`, `src/scheduler.js`, `src/providers/registry.js`, etc.
Pattern: Export objects with methods instead of bare functions

### Category E: Test Helper Refactors (Low Priority)

Files: `tests/utils/test-helpers.ts`
Pattern: Replace `mock.module()` calls with spy-based helpers

---

## Phase 1: Database Modules (Category A)

### Task 1: Verify drizzle.ts already supports spy pattern

**Files:**

- Read: `src/db/drizzle.ts`

**Verification:**
Check that `src/db/drizzle.ts` already has:

- `_setDrizzleDb()` function
- `_resetDrizzleDb()` function

**Expected:** Already exists (confirmed in analysis)

**Status:** ✅ COMPLETED

**Implementation Date:** 2026-04-01
**Commit:** `9a37983`

**Step 1: Verify existing implementation**

```bash
grep -n "_setDrizzleDb\|_resetDrizzleDb" src/db/drizzle.ts
```

Result: Functions already exist in `src/db/drizzle.ts` (confirmed).

---

### Task 2: Add test-only setters to db/index.ts

**Status:** ✅ COMPLETED

**Implementation Date:** 2026-04-01
**Commit:** `9a37983`

**Files:**

- Modify: `src/db/index.ts:1-79`

**Step 1: Write failing test**

Create: `tests/db/index-spy.test.ts`

```typescript
import { describe, expect, test, spyOn, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'

import { getMigrationDb, _setMigrationDb, _resetMigrationDb } from '../src/db/index.js'

describe('db/index.ts spy pattern', () => {
  beforeEach(() => {
    _resetMigrationDb()
  })

  test('_setMigrationDb and _resetMigrationDb exist', () => {
    expect(typeof _setMigrationDb).toBe('function')
    expect(typeof _resetMigrationDb).toBe('function')
  })

  test('can set custom database instance', () => {
    const mockDb = new Database(':memory:')
    _setMigrationDb(mockDb)
    const result = getMigrationDb()
    expect(result).toBe(mockDb)
  })

  test('_resetMigrationDb clears instance', () => {
    const mockDb = new Database(':memory:')
    _setMigrationDb(mockDb)
    _resetMigrationDb()
    // After reset, getMigrationDb should create new instance
    const newDb = getMigrationDb()
    expect(newDb).not.toBe(mockDb)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/db/index-spy.test.ts
```

Expected: FAIL - functions not exported

**Step 3: Implement setter functions**

Modify: `src/db/index.ts`

Add after line 79 (end of file):

```typescript
/**
 * Set a custom migration database instance. Useful for testing.
 * @internal
 */
export const _setMigrationDb = (db: Database): void => {
  if (migrationDbInstance !== undefined) {
    migrationDbInstance.close()
  }
  migrationDbInstance = db
}

/**
 * Reset the migration database instance. Useful for testing.
 * @internal
 */
export const _resetMigrationDb = (): void => {
  if (migrationDbInstance !== undefined) {
    migrationDbInstance.close()
    migrationDbInstance = undefined
  }
}
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/db/index-spy.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/db/index.ts tests/db/index-spy.test.ts
git commit -m "feat(db): add test-only setters for migration db to enable spyOn migration"
```

---

### Task 3: Update test helper mockDrizzle() to use spyOn

**Status:** ✅ COMPLETED

**Implementation Date:** 2026-04-01
**Commit:** `fec9f56`

**Files:**

- Modify: `tests/utils/test-helpers.ts:155-166`

**Step 1: Write failing test**

Create: `tests/utils/test-helpers-spy.test.ts`

```typescript
import { describe, expect, test, beforeEach, spyOn } from 'bun:test'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'

import * as drizzleModule from '../../src/db/drizzle.js'
import { setupTestDb } from './test-helpers.js'

describe('test-helpers spy pattern', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('mockDrizzle using spyOn instead of mock.module', async () => {
    const testDb = await setupTestDb()

    // Use spyOn on the getter
    const spy = spyOn(drizzleModule, 'getDrizzleDb').mockReturnValue(testDb)

    const result = drizzleModule.getDrizzleDb()
    expect(result).toBe(testDb)

    spy.mockRestore()
  })
})
```

**Step 2: Run test to verify current behavior**

```bash
bun test tests/utils/test-helpers-spy.test.ts
```

Expected: May fail or pass - this is a verification test

**Step 3: Add new spy-based helper functions**

Add to `tests/utils/test-helpers.ts` after line 166:

```typescript
/**
 * Mock the drizzle module using spyOn pattern (preferred over mock.module).
 * Usage: Call spyOn(drizzleModule, 'getDrizzleDb').mockReturnValue(testDb)
 *
 * Requires importing the module as: import * as drizzleModule from '../../src/db/drizzle.js'
 */
export const drizzleModule = '../../src/db/drizzle.js'
```

**Step 4: Update tests/CLAUDE.md documentation**

Modify: `tests/CLAUDE.md`

Find the "Mocking Rules" section and add:

````markdown
### spyOn Migration (In Progress)

We are migrating from `mock.module()` to `spyOn()` for better test isolation.

**New pattern for database mocks:**

```typescript
import * as drizzleModule from '../src/db/drizzle.js'
import { setupTestDb } from './utils/test-helpers.js'

let testDb: Awaited<ReturnType<typeof setupTestDb>>
let spy: ReturnType<typeof spyOn>

beforeEach(async () => {
  testDb = await setupTestDb()
  drizzleModule._setDrizzleDb(testDb)
})

afterEach(() => {
  drizzleModule._resetDrizzleDb()
})
```
````

````

**Step 5: Run full test suite**

```bash
bun test
````

Expected: All tests pass

**Step 6: Commit**

```bash
git add tests/utils/test-helpers.ts tests/CLAUDE.md tests/utils/test-helpers-spy.test.ts
git commit -m "test(helpers): add spyOn pattern documentation for database mocks"
```

---

## Phase 2: Logger Module (Category B)

### Task 4: Refactor logger.ts to support spyOn

**Status:** ✅ COMPLETED (No changes needed to logger.ts)

**Implementation Date:** 2026-04-01
**Commit:** `831b062`

**Note:** The logger module (`src/logger.ts`) was already exporting the logger as an object, making it naturally spyable. The task focused on creating a `mockLoggerSpy()` helper in `tests/utils/test-helpers.ts` that uses `spyOn()` instead of `mock.module()`.

**Files:**

- Modify: `tests/utils/test-helpers.ts` (add mockLoggerSpy function)
- Create: `tests/logger-spy.test.ts`

**Step 1: Write failing test**

Create: `tests/logger-spy.test.ts`

```typescript
import { describe, expect, test, spyOn, beforeEach, afterEach } from 'bun:test'

import * as loggerModule from '../src/logger.js'

describe('logger spy pattern', () => {
  test('can spyOn logger methods', () => {
    // Should be able to spy on logger object
    const infoSpy = spyOn(loggerModule.logger, 'info').mockImplementation(() => {})

    loggerModule.logger.info('test message')

    expect(infoSpy).toHaveBeenCalledWith('test message')
    infoSpy.mockRestore()
  })
})
```

**Step 2: Run test to verify current behavior**

```bash
bun test tests/logger-spy.test.ts
```

Expected: May pass since logger is already an object

**Step 3: Verify logger is spyable**

The logger is already exported as an object, so `spyOn(loggerModule, 'logger')` should work for the whole object, or `spyOn(loggerModule.logger, 'info')` for methods.

**Step 4: Update test helper mockLogger()**

Modify: `tests/utils/test-helpers.ts:201-206`

Add alternative spy-based implementation:

````typescript
/**
 * Setup logger mock using spyOn pattern (preferred over mock.module).
 * Returns the spy instances for assertions.
 *
 * Usage:
 * ```typescript
 * import * as loggerModule from '../../src/logger.js'
 *
 * let loggerSpies: ReturnType<typeof mockLoggerSpy>
 * beforeEach(() => { loggerSpies = mockLoggerSpy(loggerModule) })
 * afterEach(() => { loggerSpies.restoreAll() })
 * ```
 */
export function mockLoggerSpy(loggerModule: {
  logger: { debug: () => void; info: () => void; warn: () => void; error: () => void }
}): {
  debugSpy: ReturnType<typeof spyOn>
  infoSpy: ReturnType<typeof spyOn>
  warnSpy: ReturnType<typeof spyOn>
  errorSpy: ReturnType<typeof spyOn>
  restoreAll: () => void
} {
  const { spyOn } = require('bun:test')

  const debugSpy = spyOn(loggerModule.logger, 'debug').mockImplementation(() => {})
  const infoSpy = spyOn(loggerModule.logger, 'info').mockImplementation(() => {})
  const warnSpy = spyOn(loggerModule.logger, 'warn').mockImplementation(() => {})
  const errorSpy = spyOn(loggerModule.logger, 'error').mockImplementation(() => {})

  return {
    debugSpy,
    infoSpy,
    warnSpy,
    errorSpy,
    restoreAll: () => {
      debugSpy.mockRestore()
      infoSpy.mockRestore()
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    },
  }
}
````

**Step 5: Write test for new helper**

Add to `tests/logger-spy.test.ts`:

```typescript
import { mockLoggerSpy } from './utils/test-helpers.js'

describe('mockLoggerSpy helper', () => {
  test('mocks all logger methods', () => {
    const spies = mockLoggerSpy(loggerModule)

    loggerModule.logger.info('test')
    loggerModule.logger.error('error')

    expect(spies.infoSpy).toHaveBeenCalledWith('test')
    expect(spies.errorSpy).toHaveBeenCalledWith('error')

    spies.restoreAll()
  })
})
```

**Step 6: Run test**

```bash
bun test tests/logger-spy.test.ts
```

Expected: PASS

**Step 7: Commit**

```bash
git add src/logger.ts tests/utils/test-helpers.ts tests/logger-spy.test.ts
git commit -m "test(logger): add spyOn-based mockLoggerSpy helper"
```

---

## Phase 3: External Libraries (Category C)

### Task 5: Create wrapper module for 'ai' library

**Status:** ✅ COMPLETED

**Implementation Date:** 2026-04-01
**Commit:** `4c12665` (combined with Tasks 6-9)

**Files:**

- Create: `src/lib/ai-wrapper.ts`

**Step 1: Write failing test**

Create: `tests/lib/ai-wrapper.test.ts`

```typescript
import { describe, expect, test, spyOn, beforeEach } from 'bun:test'

import * as aiWrapper from '../../src/lib/ai-wrapper.js'

describe('ai-wrapper spy pattern', () => {
  beforeEach(() => {
    aiWrapper._resetGenerateText()
  })

  test('can spyOn generateText', async () => {
    const spy = spyOn(aiWrapper, 'generateText').mockResolvedValue({ text: 'mocked' })

    const result = await aiWrapper.generateText({} as any)

    expect(result.text).toBe('mocked')
    spy.mockRestore()
  })

  test('can set custom implementation', async () => {
    aiWrapper._setGenerateText(async () => ({ text: 'custom' }))

    const result = await aiWrapper.generateText({} as any)

    expect(result.text).toBe('custom')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/lib/ai-wrapper.test.ts
```

Expected: FAIL - module doesn't exist

**Step 3: Create wrapper module**

Create: `src/lib/ai-wrapper.ts`

````typescript
/**
 * Wrapper module for 'ai' library to enable spyOn-based testing.
 *
 * Instead of mocking the entire 'ai' module with mock.module(),
 * import from this wrapper and use spyOn() on the exported functions.
 *
 * @example
 * ```typescript
 * import * as aiWrapper from '../src/lib/ai-wrapper.js'
 *
 * test('example', () => {
 *   const spy = spyOn(aiWrapper, 'generateText').mockResolvedValue({ text: 'mock' })
 *   // ... test code
 *   spy.mockRestore()
 * })
 * ```
 */

import {
  generateText as originalGenerateText,
  embed as originalEmbed,
  type EmbedResult,
  type GenerateTextResult,
} from 'ai'

type GenerateTextParams = Parameters<typeof originalGenerateText>
type EmbedParams = Parameters<typeof originalEmbed>

let generateTextImpl = originalGenerateText
let embedImpl = originalEmbed

export const generateText = async (...args: GenerateTextParams): Promise<GenerateTextResult> => {
  return generateTextImpl(...args)
}

export const embed = async (...args: EmbedParams): Promise<EmbedResult> => {
  return embedImpl(...args)
}

/**
 * Set a custom generateText implementation. Useful for testing.
 * @internal
 */
export const _setGenerateText = (impl: typeof originalGenerateText): void => {
  generateTextImpl = impl
}

/**
 * Reset generateText to the original implementation. Useful for testing.
 * @internal
 */
export const _resetGenerateText = (): void => {
  generateTextImpl = originalGenerateText
}

/**
 * Set a custom embed implementation. Useful for testing.
 * @internal
 */
export const _setEmbed = (impl: typeof originalEmbed): void => {
  embedImpl = impl
}

/**
 * Reset embed to the original implementation. Useful for testing.
 * @internal
 */
export const _resetEmbed = (): void => {
  embedImpl = originalEmbed
}
````

**Step 4: Run test to verify it passes**

```bash
bun test tests/lib/ai-wrapper.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/ai-wrapper.ts tests/lib/ai-wrapper.test.ts

git commit -m "feat(lib): create ai-wrapper for spyOn-based testing of ai library"
```

---

### Task 6: Create wrapper module for '@ai-sdk/openai-compatible'

**Status:** ✅ COMPLETED

**Implementation Date:** 2026-04-01
**Commit:** `4c12665` (combined with Tasks 5, 7-9)

**Files:**

- Create: `src/lib/ai-sdk-wrapper.ts`

**Step 1: Write failing test**

Create: `tests/lib/ai-sdk-wrapper.test.ts`

```typescript
import { describe, expect, test, spyOn } from 'bun:test'

import * as aiSdkWrapper from '../../src/lib/ai-sdk-wrapper.js'

describe('ai-sdk-wrapper spy pattern', () => {
  test('can spyOn createOpenAICompatible', () => {
    const spy = spyOn(aiSdkWrapper, 'createOpenAICompatible').mockReturnValue(() => 'mock-model')

    const factory = aiSdkWrapper.createOpenAICompatible({ name: 'test', apiKey: 'key' })
    const model = factory('test-model')

    expect(model).toBe('mock-model')
    spy.mockRestore()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/lib/ai-sdk-wrapper.test.ts
```

Expected: FAIL - module doesn't exist

**Step 3: Create wrapper module**

Create: `src/lib/ai-sdk-wrapper.ts`

```typescript
/**
 * Wrapper module for '@ai-sdk/openai-compatible' to enable spyOn-based testing.
 */

import { createOpenAICompatible as originalCreateOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { OpenAICompatibleProvider } from '@ai-sdk/openai-compatible'

let createOpenAICompatibleImpl = originalCreateOpenAICompatible

export const createOpenAICompatible: typeof originalCreateOpenAICompatible = (...args) => {
  return createOpenAICompatibleImpl(...args)
}

/**
 * Set a custom implementation. Useful for testing.
 * @internal
 */
export const _setCreateOpenAICompatible = (impl: typeof originalCreateOpenAICompatible): void => {
  createOpenAICompatibleImpl = impl
}

/**
 * Reset to the original implementation. Useful for testing.
 * @internal
 */
export const _resetCreateOpenAICompatible = (): void => {
  createOpenAICompatibleImpl = originalCreateOpenAICompatible
}
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/lib/ai-sdk-wrapper.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/ai-sdk-wrapper.ts tests/lib/ai-sdk-wrapper.test.ts
git commit -m "feat(lib): create ai-sdk-wrapper for spyOn-based testing"
```

---

## Phase 4: Update Code to Use Wrappers

### Task 7: Update conversation.ts to use ai-wrapper

**Status:** ✅ COMPLETED

**Implementation Date:** 2026-04-01
**Commit:** `4c12665` (combined with Tasks 5-6, 8-9)

**Files:**

- Modify: `src/conversation.ts` (find imports)

**Step 1: Find current imports**

```bash
grep -n "import.*from 'ai'" src/conversation.ts
```

**Step 2: Update imports to use wrapper**

Replace:

```typescript
import { generateText } from 'ai'
```

With:

```typescript
import { generateText } from './lib/ai-wrapper.js'
```

**Step 3: Run tests**

```bash
bun test tests/conversation.test.ts
```

Expected: PASS

**Step 4: Commit**

```bash
git add src/conversation.ts
git commit -m "refactor(conversation): use ai-wrapper for spyOn compatibility"
```

---

### Task 8: Update llm-orchestrator.ts to use wrappers

**Status:** ✅ COMPLETED

**Implementation Date:** 2026-04-01
**Commit:** `4c12665` (combined with Tasks 5-7, 9)

**Files:**

- Modify: `src/llm-orchestrator.ts`

**Step 1: Find current imports**

```bash
grep -n "import.*from 'ai'\|import.*from '@ai-sdk" src/llm-orchestrator.ts
```

**Step 2: Update imports**

Replace imports from `'ai'` and `'@ai-sdk/openai-compatible'` to use wrappers.

**Step 3: Run tests**

```bash
bun test tests/llm-orchestrator-process.test.ts
```

Expected: PASS

**Step 4: Commit**

```bash
git add src/llm-orchestrator.ts
git commit -m "refactor(llm): use wrapper modules for spyOn compatibility"
```

---

## Phase 5: Update Tests to Use spyOn

### Task 9: Update memory.test.ts to use spyOn

**Status:** ✅ COMPLETED

**Implementation Date:** 2026-04-01
**Commit:** `4c12665` (combined with Tasks 5-8)

**Files:**

- Modify: `tests/memory.test.ts:1-711`

**Step 1: Analyze current mock usage**

The file uses:

- `mock.module('../src/db/drizzle.js', ...)`
- `mock.module('ai', ...)`

**Step 2: Replace with spyOn pattern**

Replace:

```typescript
void mock.module('../src/db/drizzle.js', () => ({
  getDrizzleDb: (): typeof testDb => testDb,
}))

void mock.module('ai', () => ({
  generateText: (..._args: unknown[]): Promise<GenerateTextResult> => generateTextImpl(),
}))
```

With:

```typescript
import * as drizzleModule from '../src/db/drizzle.js'
import * as aiWrapper from '../src/lib/ai-wrapper.js'

// In beforeEach:
beforeEach(async () => {
  testDb = await setupTestDb()
  drizzleModule._setDrizzleDb(testDb)

  // Reset AI wrapper
  aiWrapper._resetGenerateText()
})

afterEach(() => {
  drizzleModule._resetDrizzleDb()
  aiWrapper._resetGenerateText()
})

// For per-test overrides, use spyOn:
test('example', async () => {
  const spy = spyOn(aiWrapper, 'generateText').mockResolvedValue({ text: 'custom' })
  // ... test
  spy.mockRestore()
})
```

**Step 3: Run tests**

```bash
bun test tests/memory.test.ts
```

Expected: PASS

**Step 4: Commit**

```bash
git add tests/memory.test.ts
git commit -m "test(memory): migrate from mock.module to spyOn"
```

---

### Task 10: Update conversation.test.ts to use spyOn

**Status:** ✅ COMPLETED

**Implementation Date:** 2026-04-01
**Commit:** `4c12665` (combined with Tasks 5-9)

**Files:**

- Modify: `tests/conversation.test.ts`

**Step 1: Replace mock.module with spyOn**

Replace:

```typescript
void mock.module('ai', () => ({
  generateText: (..._args: unknown[]): Promise<GenerateTextResult> => generateTextImpl(),
}))

void mock.module('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: ...
}))
```

With spyOn on the wrapper modules.

**Step 2: Run tests**

```bash
bun test tests/conversation.test.ts
```

Expected: PASS

**Step 3: Commit**

```bash
git add tests/conversation.test.ts
git commit -m "test(conversation): migrate from mock.module to spyOn"
```

---

## Phase 6: Internal Business Logic (Category D) — PENDING

**Status:** ⏳ NOT STARTED

### Task 11: Create registry pattern for providers

**Files:**

- Modify: `src/providers/registry.ts`

**Step 1: Analyze current exports**

```bash
cat src/providers/registry.ts
```

**Step 2: Refactor to export object**

If it exports bare functions, refactor to:

```typescript
export const providerRegistry = {
  createProvider: (name: string, config: unknown): TaskProvider => {
    // existing logic
  },
  // other functions
}

// Keep backward compatibility
export const createProvider = providerRegistry.createProvider
```

**Step 3: Add test setters**

```typescript
let createProviderImpl = providerRegistry.createProvider

export const _setCreateProvider = (impl: typeof providerRegistry.createProvider): void => {
  createProviderImpl = impl
}

export const _resetCreateProvider = (): void => {
  createProviderImpl = providerRegistry.createProvider
}
```

**Step 4: Update tests**

Replace `mock.module('../../src/providers/registry.js', ...)` with spyOn on providerRegistry object.

**Step 5: Run tests**

```bash
bun test tests/scheduler.test.ts
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/providers/registry.ts tests/scheduler.test.ts
git commit -m "refactor(providers): enable spyOn pattern for registry"
```

---

## Phase 7: Recurring Tasks Module — PENDING

**Status:** ⏳ NOT STARTED

### Task 12: Export recurring module as object

**Files:**

- Modify: `src/recurring.ts` (if it exports bare functions)

**Step 1: Check export pattern**

```bash
grep -n "^export" src/recurring.ts | head -20
```

**Step 2: If exporting bare functions, create object wrapper**

Create pattern similar to:

```typescript
export const recurringApi = {
  createRecurringTask: (input: RecurringTaskInput): RecurringTaskRecord => {
    // implementation
  },
  deleteRecurringTask: ...
  // etc
}

// Backward compatibility - re-export individual functions
export const createRecurringTask = recurringApi.createRecurringTask
export const deleteRecurringTask = recurringApi.deleteRecurringTask
// etc
```

**Step 3: Update tests**

Replace:

```typescript
void mock.module('../../src/recurring.js', () => ({
  createRecurringTask: ...
}))
```

With:

```typescript
import * as recurringModule from '../../src/recurring.js'

// In test:
const spy = spyOn(recurringModule.recurringApi, 'createRecurringTask').mockReturnValue(...)
```

**Step 4: Run tests**

```bash
bun test tests/tools/recurring-tools.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/recurring.ts tests/tools/recurring-tools.test.ts
git commit -m "refactor(recurring): export as object for spyOn compatibility"
```

---

## Phase 8: Scheduler Module — PENDING

**Status:** ⏳ NOT STARTED

### Task 13: Export scheduler module as object

**Files:**

- Modify: `src/scheduler.ts`

Follow same pattern as Task 12.

---

## Phase 9: Remaining Test Files — PENDING

**Status:** ⏳ NOT STARTED

### Task 14: Update remaining test files

**Files:**

- tests/providers/kaneo/task-status.test.ts
- tests/providers/kaneo/task-resource.test.ts
- tests/wizard/\*.test.ts
- tests/deferred-prompts/\*.test.ts
- tests/announcements.test.ts

**Step 1: For each file, identify mock.module() usage**

```bash
bun scripts/find-mock-modules.ts
```

**Step 2: Apply appropriate migration pattern**

Based on what's being mocked:

- Database mocks → Use `_setDrizzleDb()` / `_resetDrizzleDb()`
- Logger mocks → Use `mockLoggerSpy()`
- External libs → Use wrapper modules
- Internal modules → Use spyOn on exported objects

**Step 3: Run full test suite after each batch**

```bash
bun test
```

**Step 4: Commit per batch**

```bash
git commit -m "test(batch): migrate test files from mock.module to spyOn"
```

---

## Phase 10: Cleanup and Documentation — PENDING

**Status:** ⏳ NOT STARTED

### Task 15: Remove mock.module() from test helpers

**Files:**

- Modify: `tests/utils/test-helpers.ts`

**Step 1: Update mockDrizzle() to use spyOn**

Replace the `mock.module()` implementation in `mockDrizzle()` with:

```typescript
export function mockDrizzle(): void {
  // Deprecated: Use spyOn pattern instead
  // import * as drizzleModule from '../../src/db/drizzle.js'
  // spyOn(drizzleModule, 'getDrizzleDb').mockReturnValue(getTestDb())
  throw new Error('mockDrizzle() is deprecated. Use spyOn(drizzleModule, "getDrizzleDb") instead.')
}
```

**Step 2: Update mockLogger() similarly**

**Step 3: Update tests/CLAUDE.md**

Remove references to `mock.module()` pattern, update with spyOn pattern.

**Step 4: Run tests**

```bash
bun test
```

Expected: PASS

**Step 5: Commit**

```bash
git commit -m "chore(tests): deprecate mock.module helpers in favor of spyOn"
```

---

### Task 16: Update scripts/find-mock-modules.ts

**Status:** ⏳ NOT STARTED

**Note:** The find-mock-modules.ts script was created but still reports mock.module() usage. After completing the migration, update the script to:

1. Add detection for spyOn-based patterns
2. Update recommendations section with spyOn patterns
3. Report "migration complete" when no mock.module() calls remain

**Files:**

- Modify: `scripts/find-mock-modules.ts`

**Step 1: Update to detect spyOn usage**

Add detection for spyOn-based patterns and report them as "migrated".

**Step 2: Update recommendations**

Replace recommendations section with:

```typescript
console.log(`
📚 Migration Complete Guide:
   spyOn() provides better isolation than mock.module()
   
   Pattern by module type:
   
   Database (src/db/drizzle.js):
     import * as drizzleModule from '../src/db/drizzle.js'
     drizzleModule._setDrizzleDb(testDb)
     afterEach(() => drizzleModule._resetDrizzleDb())
   
   Logger (src/logger.js):
     import * as loggerModule from '../src/logger.js'
     const spy = spyOn(loggerModule.logger, 'info').mockImplementation(() => {})
     spy.mockRestore()
   
   External libraries:
     Import from src/lib/*-wrapper.ts instead
     spyOn(aiWrapper, 'generateText').mockResolvedValue({ text: 'mock' })
`)
```

**Step 3: Commit**

```bash
git add scripts/find-mock-modules.ts
git commit -m "docs(scripts): update mock module finder for spyOn migration"
```

---

### Task 17: Final verification

**Step 1: Run full test suite**

```bash
bun test
```

Expected: All tests pass

**Step 2: Run mock pollution check**

```bash
bun run mock-pollution
```

Expected: No pollution detected

**Step 3: Verify no mock.module() remains**

```bash
bun scripts/find-mock-modules.ts
```

Expected: "No mock.module() usages found!"

**Step 4: Commit**

```bash
git commit -m "test: complete migration from mock.module to spyOn"
```

---

## Summary

This migration eliminates Bun's mock pollution issues by:

1. **Database modules**: Added `_set*()` and `_reset*()` functions for test injection
2. **Logger**: Already object-based, added `mockLoggerSpy()` helper
3. **External libraries**: Created wrapper modules with mutable implementations
4. **Internal modules**: Refactored to export objects with methods (spyable)

**Benefits:**

- Better test isolation (no global module state)
- Cleaner test code (no need for `afterAll(() => mock.restore())`)
- More predictable test execution order
- Easier to understand mocking patterns

**Trade-offs:**

- Added wrapper modules for external libraries
- Some modules export additional test-only functions
- Requires updating import statements in source code
