# Global Mock Reset Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate mock pollution from `mock.module()` so tests pass under `bun test --randomize`.

**Architecture:** A preload script captures real module exports at startup and restores them in a global `beforeEach`. Each test file moves its `mock.module()` calls from top-level into `describe`-level `beforeEach`, ensuring that mocks are re-applied per-test and never leak between files.

**Tech Stack:** Bun test runner (`bun:test`), TypeScript, `mock.module()` live binding updates

---

## Background

Bun's `mock.module()` is process-global and permanent. `mock.restore()` does NOT reset module mocks — only spies. Since Bun runs all test files in a single process, mocks leak. The fix: a global `beforeEach` restores real modules, then each file's `beforeEach` re-applies its own mocks.

**Key property:** `mock.module()` updates ES module live bindings even for already-imported modules. This means calling it in `beforeEach` (after top-level imports) works — all importers see the updated exports.

**Design doc:** `docs/plans/2026-04-05-mock-pollution-global-reset.md`

---

## Task 1: Create `tests/mock-reset.ts` preload

**Files:**

- Create: `tests/mock-reset.ts`

**Step 1: Write the preload script**

```typescript
/**
 * Global mock reset preload.
 *
 * Captures real exports of all commonly-mocked modules at startup (before any
 * test file can mock them), then restores originals in a global beforeEach.
 * Individual test files override in their own describe-level beforeEach.
 *
 * Order per test:
 *   global beforeEach (restore originals) -> file beforeEach (apply mocks) -> test -> global afterEach (restore spies)
 */

import { afterEach, beforeEach, mock } from 'bun:test'

// Capture real module exports BEFORE any test file loads.
// Spread into plain objects to snapshot current values.
import * as _drizzle from '../src/db/drizzle.js'
import * as _dbIndex from '../src/db/index.js'
import * as _logger from '../src/logger.js'
import * as _messageCache from '../src/message-cache/cache.js'
import * as _kaneoProvision from '../src/providers/kaneo/provision.js'
import * as _kaneoListColumns from '../src/providers/kaneo/list-columns.js'
import * as _recurring from '../src/recurring.js'
import * as _scheduler from '../src/scheduler.js'
import * as _providersRegistry from '../src/providers/registry.js'
import * as _providersFactory from '../src/providers/factory.js'
import * as _changelogReader from '../src/changelog-reader.js'
import * as _llmOrchestrator from '../src/llm-orchestrator.js'
import * as _ai from 'ai'
import * as _openaiCompat from '@ai-sdk/openai-compatible'

const originals: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ['../src/db/drizzle.js', { ..._drizzle }],
  ['../src/db/index.js', { ..._dbIndex }],
  ['../src/logger.js', { ..._logger }],
  ['../src/message-cache/cache.js', { ..._messageCache }],
  ['../src/providers/kaneo/provision.js', { ..._kaneoProvision }],
  ['../src/providers/kaneo/list-columns.js', { ..._kaneoListColumns }],
  ['../src/recurring.js', { ..._recurring }],
  ['../src/scheduler.js', { ..._scheduler }],
  ['../src/providers/registry.js', { ..._providersRegistry }],
  ['../src/providers/factory.js', { ..._providersFactory }],
  ['../src/changelog-reader.js', { ..._changelogReader }],
  ['../src/llm-orchestrator.js', { ..._llmOrchestrator }],
  ['ai', { ..._ai }],
  ['@ai-sdk/openai-compatible', { ..._openaiCompat }],
]

beforeEach(() => {
  for (const [path, exports] of originals) {
    mock.module(path, () => ({ ...exports }))
  }
})

afterEach(() => {
  mock.restore()
})
```

**Step 2: Verify file exists**

Run: `ls tests/mock-reset.ts`
Expected: File listed

---

## Task 2: Update `bunfig.toml` and verify preload

**Files:**

- Modify: `bunfig.toml:9`

**Step 1: Add mock-reset to preload**

Change line 9 from:

```toml
preload = ["./tests/setup.ts"]
```

To:

```toml
preload = ["./tests/setup.ts", "./tests/mock-reset.ts"]
```

**Step 2: Run one test file to verify preload loads**

Run: `bun test tests/errors.test.ts`
Expected: PASS (this file has no mocks — confirms preload doesn't break clean files)

**Step 3: Commit infrastructure**

```bash
git add tests/mock-reset.ts bunfig.toml
git commit -m "test: add global mock reset preload to eliminate mock pollution"
```

---

## Task 3: Refactor helper functions

**Files:**

- Modify: `tests/utils/logger-mock.ts:63-68`
- Modify: `tests/utils/test-helpers.ts:76-91,156-165`

The helpers `mockLogger()`, `mockDrizzle()`, `mockMessageCache()` call `mock.module()` at call time. They still work when called from `beforeEach` — no code change needed in the helper implementations. The change is in how callers use them: from top-level to `beforeEach`.

However, the helpers need a companion "idempotent" quality: they should be safe to call in `beforeEach` even when the global reset already restored the originals. Currently they are — `mock.module()` simply replaces the current binding. No changes needed to helper function bodies.

**Step 1: Verify helpers are beforeEach-safe**

Read `tests/utils/logger-mock.ts:63-68` and `tests/utils/test-helpers.ts:156-165`. Both call `void mock.module(...)` which is always safe to call multiple times.

**Step 2: Add a comment documenting the new usage pattern**

In `tests/utils/logger-mock.ts`, update the JSDoc on `mockLogger()`:

```typescript
/**
 * Setup logger mock for tests.
 * Call in describe-level beforeEach (NOT at top level) to avoid mock pollution.
 *
 * @example
 * describe('Feature', () => {
 *   beforeEach(() => {
 *     mockLogger()
 *   })
 * })
 */
```

Apply same JSDoc update to `mockDrizzle()` and `mockMessageCache()` in `tests/utils/test-helpers.ts`.

**Step 3: Commit**

```bash
git add tests/utils/logger-mock.ts tests/utils/test-helpers.ts
git commit -m "docs(test-helpers): document beforeEach usage pattern for mock helpers"
```

---

## Transformation Patterns

All subsequent tasks apply one of these patterns. Reference by letter.

### Pattern A: Helper-only files (mockLogger / mockDrizzle / mockMessageCache)

Before:

```typescript
import { mockLogger, mockDrizzle, setupTestDb } from './utils/test-helpers.js'
mockLogger()
mockDrizzle()

import { something } from '../src/module.js'

describe('Feature', () => {
  afterAll(() => { mock.restore() })
  beforeEach(async () => {
    testDb = await setupTestDb()
  })
  test('works', () => { ... })
})
```

After:

```typescript
import { mockLogger, mockDrizzle, setupTestDb } from './utils/test-helpers.js'
import { something } from '../src/module.js'

describe('Feature', () => {
  beforeEach(async () => {
    mockLogger()
    mockDrizzle()
    testDb = await setupTestDb()
  })
  test('works', () => { ... })
})
```

Changes:

1. Move `mockLogger()` / `mockDrizzle()` / `mockMessageCache()` from top-level into the first `beforeEach` inside the outermost `describe`
2. Move imports above (no longer need to follow mock registration)
3. Remove `afterAll(() => { mock.restore() })` — global handles it
4. If file has `beforeEach` at file-level (outside describe), move it inside describe

### Pattern B: Inline mock.module + mutable let impl

Before:

```typescript
let generateTextImpl = () => Promise.resolve(defaultResult)

void mock.module('ai', () => ({
  generateText: (...args: unknown[]) => generateTextImpl(),
}))

import { functionUnderTest } from '../src/module.js'

describe('Feature', () => {
  afterAll(() => {
    mock.restore()
  })
  beforeEach(() => {
    generateTextImpl = () => Promise.resolve(defaultResult)
  })
  test('custom', () => {
    generateTextImpl = () => Promise.resolve(customResult)
    // ...
  })
})
```

After:

```typescript
import { functionUnderTest } from '../src/module.js'

describe('Feature', () => {
  let generateTextImpl = () => Promise.resolve(defaultResult)

  beforeEach(() => {
    generateTextImpl = () => Promise.resolve(defaultResult)
    mock.module('ai', () => ({
      generateText: (...args: unknown[]) => generateTextImpl(),
    }))
  })

  test('custom', () => {
    generateTextImpl = () => Promise.resolve(customResult)
    // ...
  })
})
```

Changes:

1. Move `let impl` declarations inside `describe`
2. Move `mock.module()` into `beforeEach`, AFTER resetting impl to default
3. Move imports to top of file
4. Remove `afterAll(() => { mock.restore() })`
5. Keep per-test overrides of `impl` as-is

### Pattern C: Helper + inline mock.module combo

Combines Pattern A and B. Move helpers AND inline mocks into `beforeEach`.

### Pattern D: Tracked logger mock (wizard/engine.test.ts style)

Before:

```typescript
const { getLogLevel, logger } = createTrackedLoggerMock()
void mock.module('../../src/logger.js', () => ({ getLogLevel, logger }))
```

After:

```typescript
describe('Feature', () => {
  let trackedLogger: TrackedLoggerMock

  beforeEach(() => {
    trackedLogger = createTrackedLoggerMock()
    mock.module('../../src/logger.js', () => ({
      getLogLevel: trackedLogger.getLogLevel,
      logger: trackedLogger.logger,
    }))
  })
})
```

---

## Task 4: Batch refactor — helper-only files (Group 1: tools/)

**Pattern:** A
**Files (15):**

- `tests/tools/comment-tools.test.ts` — mockLogger
- `tests/tools/confirmation-gate.test.ts` — mockLogger
- `tests/tools/instructions.test.ts` — mockLogger + mockDrizzle
- `tests/tools/label-tools.test.ts` — mockLogger
- `tests/tools/memo-tools.test.ts` — mockLogger + mockDrizzle
- `tests/tools/project-tools.test.ts` — mockLogger
- `tests/tools/status-tools.test.ts` — mockLogger
- `tests/tools/task-label-tools.test.ts` — mockLogger
- `tests/tools/task-relation-tools.test.ts` — mockLogger
- `tests/tools/task-scenarios.test.ts` — mockLogger
- `tests/tools/task-tools.test.ts` — mockLogger
- `tests/db/migrate.test.ts` — mockLogger
- `tests/cron.test.ts` — mockLogger
- `tests/commands/help.test.ts` — mockLogger
- `tests/commands/group.test.ts` — mockLogger + mockDrizzle

**Step 1: For each file, apply Pattern A**

For each file:

1. Move `mockLogger()` (and `mockDrizzle()` if present) from top-level into the first `beforeEach` inside the outermost `describe`
2. If the file's `describe` already has a `beforeEach`, prepend the helper calls as the first lines
3. If no `beforeEach` exists, add one: `beforeEach(() => { mockLogger() })`
4. Move imports to top (above describe)
5. Remove `afterAll(() => { mock.restore() })` if present

**Step 2: Run batch test**

Run: `bun test tests/tools/ tests/db/migrate.test.ts tests/cron.test.ts tests/commands/help.test.ts tests/commands/group.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/tools/ tests/db/migrate.test.ts tests/cron.test.ts tests/commands/help.test.ts tests/commands/group.test.ts
git commit -m "test: move mock helpers to beforeEach in tools/db/commands tests"
```

---

## Task 5: Batch refactor — helper-only files (Group 2: providers/ + message-cache/ + chat/)

**Pattern:** A
**Files (17):**

- `tests/providers/kaneo/column-resource.test.ts` — mockLogger
- `tests/providers/kaneo/comment-resource.test.ts` — mockLogger
- `tests/providers/kaneo/label-resource.test.ts` — mockLogger
- `tests/providers/kaneo/project-resource.test.ts` — mockLogger
- `tests/providers/kaneo/provision.test.ts` — mockLogger
- `tests/providers/kaneo/schema-validation.test.ts` — mockLogger
- `tests/providers/kaneo/task-relations.test.ts` — mockLogger
- `tests/providers/youtrack/labels.test.ts` — mockLogger
- `tests/providers/youtrack/operations/comments.test.ts` — mockLogger
- `tests/providers/youtrack/operations/projects.test.ts` — mockLogger
- `tests/providers/youtrack/operations/tasks.test.ts` — mockLogger
- `tests/message-cache/cache.test.ts` — mockLogger + mockDrizzle
- `tests/message-cache/chain.test.ts` — mockLogger + mockMessageCache
- `tests/message-cache/integration.test.ts` — mockLogger + mockMessageCache
- `tests/chat/telegram/index.test.ts` — mockLogger
- `tests/chat/telegram/reply-context.test.ts` — mockMessageCache
- `tests/chat/config-editor-integration.test.ts` — mockLogger + mockDrizzle

**Step 1: Apply Pattern A to each file**

Same transformation as Task 4.

**Step 2: Run batch test**

Run: `bun test tests/providers/ tests/message-cache/ tests/chat/`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/providers/ tests/message-cache/ tests/chat/
git commit -m "test: move mock helpers to beforeEach in providers/message-cache/chat tests"
```

---

## Task 6: Batch refactor — helper-only files (Group 3: remaining)

**Pattern:** A
**Files (18):**

- `tests/config-editor/handlers.test.ts` — mockLogger + mockDrizzle
- `tests/config-editor/index.test.ts` — mockLogger
- `tests/config-editor/state.test.ts` — mockLogger
- `tests/config-editor/validation.test.ts` — mockLogger
- `tests/deferred-prompts/alerts.test.ts` — mockLogger + mockDrizzle
- `tests/deferred-prompts/proactive-trigger.test.ts` — mockLogger + mockDrizzle
- `tests/deferred-prompts/scheduled.test.ts` — mockLogger + mockDrizzle
- `tests/deferred-prompts/snapshots.test.ts` — mockLogger + mockDrizzle
- `tests/deferred-prompts/tools.test.ts` — mockLogger + mockDrizzle
- `tests/group-context-isolation.test.ts` — mockLogger + mockDrizzle
- `tests/instructions.test.ts` — mockLogger + mockDrizzle
- `tests/instructions-cache.test.ts` — mockLogger + mockDrizzle
- `tests/llm-orchestrator-system-prompt.test.ts` — mockLogger + mockDrizzle
- `tests/reply-context.test.ts` — mockLogger + mockMessageCache
- `tests/wizard-integration.test.ts` — mockLogger + mockDrizzle
- `tests/wizard/integration.test.ts` — mockLogger + mockDrizzle
- `tests/commands/config.test.ts` — mockLogger + mockDrizzle
- `tests/commands/restrictions.test.ts` — mockLogger + mockDrizzle

**Step 1: Apply Pattern A to each file**

Same transformation as Task 4.

**Step 2: Run tests**

Run: `bun test tests/config-editor/ tests/deferred-prompts/ tests/group-context-isolation.test.ts tests/instructions.test.ts tests/instructions-cache.test.ts tests/llm-orchestrator-system-prompt.test.ts tests/reply-context.test.ts tests/wizard-integration.test.ts tests/wizard/ tests/commands/config.test.ts tests/commands/restrictions.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/config-editor/ tests/deferred-prompts/ tests/group-context-isolation.test.ts tests/instructions.test.ts tests/instructions-cache.test.ts tests/llm-orchestrator-system-prompt.test.ts tests/reply-context.test.ts tests/wizard-integration.test.ts tests/wizard/ tests/commands/config.test.ts tests/commands/restrictions.test.ts
git commit -m "test: move mock helpers to beforeEach in remaining helper-only files"
```

---

## Task 7: Refactor — simple inline mock.module files

**Pattern:** C (helper + inline combo)
**Files (11):**

- `tests/bot.test.ts` — mockLogger + inline drizzle mock
- `tests/config.test.ts` — mockLogger + inline drizzle mock
- `tests/users.test.ts` — mockLogger + inline drizzle mock
- `tests/groups.test.ts` — mockLogger + inline drizzle mock
- `tests/index-startup.test.ts` — mockLogger + inline drizzle mock
- `tests/recurring.test.ts` — mockLogger + inline drizzle mock
- `tests/memos.test.ts` — mockLogger + inline drizzle + inline db/index
- `tests/history.test.ts` — mockLogger + inline drizzle + inline db/index
- `tests/persistence-ac.test.ts` — mockLogger + inline drizzle + inline db/index
- `tests/message-cache/persistence.test.ts` — mockLogger + inline drizzle mock
- `tests/commands/start.test.ts` — mockLogger + inline drizzle mock

**Step 1: For each file, apply Pattern C**

The drizzle inline mock pattern looks like:

Before:

```typescript
mockLogger()
let testDb: Awaited<ReturnType<typeof setupTestDb>>
void mock.module('../src/db/drizzle.js', () => ({
  getDrizzleDb: (): typeof testDb => testDb,
  closeDrizzleDb: (): void => {},
  _resetDrizzleDb: (): void => {},
  _setDrizzleDb: (): void => {},
}))
import { something } from '../src/module.js'

describe('Feature', () => {
  beforeEach(async () => { testDb = await setupTestDb() })
```

After:

```typescript
import { something } from '../src/module.js'

describe('Feature', () => {
  let testDb: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    mockLogger()
    testDb = await setupTestDb()
    mock.module('../src/db/drizzle.js', () => ({
      getDrizzleDb: (): typeof testDb => testDb,
      closeDrizzleDb: (): void => {},
      _resetDrizzleDb: (): void => {},
      _setDrizzleDb: (): void => {},
    }))
  })
```

For files that also mock `db/index.js`, include that in the same `beforeEach`:

```typescript
mock.module('../src/db/index.js', () => ({
  getDb: (): import('bun:sqlite').Database => testSqlite,
  DB_PATH: ':memory:',
  initDb: (): void => {},
}))
```

**Step 2: Run batch test**

Run: `bun test tests/bot.test.ts tests/config.test.ts tests/users.test.ts tests/groups.test.ts tests/index-startup.test.ts tests/recurring.test.ts tests/memos.test.ts tests/history.test.ts tests/persistence-ac.test.ts tests/message-cache/persistence.test.ts tests/commands/start.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/bot.test.ts tests/config.test.ts tests/users.test.ts tests/groups.test.ts tests/index-startup.test.ts tests/recurring.test.ts tests/memos.test.ts tests/history.test.ts tests/persistence-ac.test.ts tests/message-cache/persistence.test.ts tests/commands/start.test.ts
git commit -m "test: move drizzle mock.module to beforeEach in simple inline mock files"
```

---

## Task 8: Refactor — AI SDK mock files

**Pattern:** B + C
**Files (4):**

- `tests/conversation.test.ts` — inline ai + @ai-sdk/openai-compatible
- `tests/embeddings.test.ts` — mockLogger + inline ai + @ai-sdk/openai-compatible
- `tests/deferred-prompts/execution-modes.test.ts` — mockLogger + mockDrizzle + inline ai + @ai-sdk/openai-compatible
- `tests/deferred-prompts/poller.test.ts` — mockLogger + mockDrizzle + inline ai + @ai-sdk/openai-compatible

**Step 1: For each file, apply Pattern B for AI mocks + Pattern A for helpers**

The AI mock pattern:

Before:

```typescript
let generateTextImpl = () => Promise.resolve({ text: 'Done.', ... })
void mock.module('ai', () => ({
  generateText: (..._args: unknown[]) => generateTextImpl(),
  tool: (opts: unknown) => opts,
  stepCountIs: (_n: number) => undefined,
}))
void mock.module('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: () => () => 'mock-model',
}))
import { functionUnderTest } from '../src/module.js'
```

After:

```typescript
import { functionUnderTest } from '../src/module.js'

describe('Feature', () => {
  let generateTextImpl = () => Promise.resolve({ text: 'Done.', ... })

  beforeEach(() => {
    mockLogger()       // if applicable
    mockDrizzle()      // if applicable
    generateTextImpl = () => Promise.resolve({ text: 'Done.', ... })
    mock.module('ai', () => ({
      generateText: (..._args: unknown[]) => generateTextImpl(),
      tool: (opts: unknown) => opts,
      stepCountIs: (_n: number) => undefined,
    }))
    mock.module('@ai-sdk/openai-compatible', () => ({
      createOpenAICompatible: () => () => 'mock-model',
    }))
  })
})
```

**Important for conversation.test.ts:** This file preserves real `tool` export. Use `const realAi = await import('ai')` in the `describe` scope (via `beforeAll`) and spread it: `...realAi` inside the mock factory. Or capture it at file top-level since the preload already loaded the real module.

**Step 2: Run batch test**

Run: `bun test tests/conversation.test.ts tests/embeddings.test.ts tests/deferred-prompts/execution-modes.test.ts tests/deferred-prompts/poller.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/conversation.test.ts tests/embeddings.test.ts tests/deferred-prompts/execution-modes.test.ts tests/deferred-prompts/poller.test.ts
git commit -m "test: move AI SDK mock.module to beforeEach"
```

---

## Task 9: Refactor — complex files with multiple inline mocks

**Pattern:** B + C + D
**Files (7):**

- `tests/llm-orchestrator.test.ts` — mockLogger + mockDrizzle + 5 inline mocks (db/index, providers/factory, kaneo/provision, ai, @ai-sdk/openai-compatible)
- `tests/scheduler.test.ts` — mockLogger + 2 inline mocks (providers/registry, db/drizzle)
- `tests/announcements.test.ts` — mockLogger + 2 inline mocks (db/drizzle, changelog-reader)
- `tests/memory.test.ts` — mockLogger + 3 inline mocks (db/drizzle, db/index, ai)
- `tests/commands/admin.test.ts` — mockLogger + mockDrizzle + 1 inline mock (kaneo/provision)
- `tests/commands/bot-auth.test.ts` — mockLogger + mockDrizzle + 1 inline mock (llm-orchestrator)
- `tests/tools/recurring-tools.test.ts` — mockLogger + 2 inline mocks (recurring, scheduler)

**Step 1: For each file, apply Patterns B+C**

Key transformation for `llm-orchestrator.test.ts`:

- Move ALL 5 `mock.module()` calls + `mockLogger()` + `mockDrizzle()` into `describe`-level `beforeEach`
- Move `generateTextImpl` and `defaultGenerateTextResult` inside `describe`
- The `const realAi = await import('ai')` and `const realProvisionMod = await import(...)` patterns should be kept at file-level (outside describe) since they capture real module references before any mock — the preload guarantees these are real at import time
- Reset all mutable state (`generateTextImpl = defaultGenerateTextResult`) in `beforeEach`

Key transformation for `scheduler.test.ts`:

- Move all `let` declarations (`createTaskImpl`, `addTaskLabelImpl`, `mockCapabilities`, etc.) inside `describe`
- Move `mock.module('../src/providers/registry.js', ...)` and `mock.module('../src/db/drizzle.js', ...)` into `beforeEach`
- Keep the `mockChatProvider` object and helpers as-is (they don't pollute)

Key transformation for `tools/recurring-tools.test.ts`:

- Move 30+ `let` state variables into `describe`
- Move both `mock.module('../../src/recurring.js', ...)` and `mock.module('../../src/scheduler.js', ...)` into `beforeEach`
- Ensure all `let` variables are reset to defaults in `beforeEach`

**Step 2: Run each file individually after transformation**

Run: `bun test tests/llm-orchestrator.test.ts`
Run: `bun test tests/scheduler.test.ts`
Run: `bun test tests/announcements.test.ts`
Run: `bun test tests/memory.test.ts`
Run: `bun test tests/commands/admin.test.ts`
Run: `bun test tests/commands/bot-auth.test.ts`
Run: `bun test tests/tools/recurring-tools.test.ts`
Expected: All PASS

**Step 3: Commit**

```bash
git add tests/llm-orchestrator.test.ts tests/scheduler.test.ts tests/announcements.test.ts tests/memory.test.ts tests/commands/admin.test.ts tests/commands/bot-auth.test.ts tests/tools/recurring-tools.test.ts
git commit -m "test: move complex multi-mock files to beforeEach pattern"
```

---

## Task 10: Refactor — remaining inline mock files

**Pattern:** B, C, D
**Files (5):**

- `tests/providers/kaneo/task-resource.test.ts` — mockLogger + inline list-columns mock
- `tests/providers/kaneo/task-status.test.ts` — mockLogger + inline list-columns mock
- `tests/tools/completion-hook.test.ts` — mockLogger + inline recurring mock
- `tests/wizard/engine.test.ts` — tracked logger mock (Pattern D) + mockDrizzle + dynamic imports
- `tests/wizard/state.test.ts` — inline logger mock
- `tests/utils/scheduler.test.ts` — inline logger mock

**Step 1: Apply appropriate pattern to each file**

For `wizard/engine.test.ts` (Pattern D):

- Move `createTrackedLoggerMock()` + `mock.module('../../src/logger.js', ...)` into `describe`-level `beforeEach`
- Move `mockDrizzle()` into the same `beforeEach`
- Dynamic imports (`await import(...)`) can stay at file-level — they will get the mocked versions once `beforeEach` runs, because live bindings update
- Actually: dynamic imports at file-level run ONCE. Move them inside tests or use a `beforeAll` with `let` variables

For `wizard/state.test.ts` and `utils/scheduler.test.ts`:

- Move inline `mock.module('../../src/logger.js', ...)` into `describe`-level `beforeEach`

For `providers/kaneo/task-resource.test.ts` and `task-status.test.ts`:

- Move `mockLogger()` + `mock.module('.../list-columns.js', ...)` into `describe`-level `beforeEach`
- Note: `task-resource.test.ts` has `mock.restore()` in its own `beforeEach` — remove it (global handles reset)

**Step 2: Run batch test**

Run: `bun test tests/providers/kaneo/task-resource.test.ts tests/providers/kaneo/task-status.test.ts tests/tools/completion-hook.test.ts tests/wizard/engine.test.ts tests/wizard/state.test.ts tests/utils/scheduler.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/providers/kaneo/task-resource.test.ts tests/providers/kaneo/task-status.test.ts tests/tools/completion-hook.test.ts tests/wizard/engine.test.ts tests/wizard/state.test.ts tests/utils/scheduler.test.ts
git commit -m "test: move remaining inline mock.module calls to beforeEach"
```

---

## Task 11: Sweep — remove all orphaned afterAll mock.restore()

**Step 1: Find remaining afterAll cleanup**

Run: `grep -rn "afterAll.*mock.restore\|mock\.restore.*afterAll" tests/ --include="*.test.ts"`

**Step 2: Remove each occurrence**

The global `afterEach` in `mock-reset.ts` handles `mock.restore()`. Remove all:

```typescript
afterAll(() => {
  mock.restore()
})
```

**Exception:** Keep any `afterAll` that does MORE than `mock.restore()` (e.g., `llm-orchestrator.test.ts` restores env vars). In those cases, remove only the `mock.restore()` line but keep the `afterAll` with remaining logic.

**Step 3: Run full suite**

Run: `bun test`
Expected: PASS

**Step 4: Commit**

```bash
git add tests/
git commit -m "test: remove orphaned afterAll mock.restore (global reset handles it)"
```

---

## Task 12: Update tests/CLAUDE.md

**Files:**

- Modify: `tests/CLAUDE.md`

**Step 1: Update mock pollution prevention section**

Replace the "Mock Pollution Prevention" section with updated guidance:

````markdown
## Mock Pollution Prevention

`mock.module()` is global and permanent in Bun. The preload `tests/mock-reset.ts`
restores real modules before every test via a global `beforeEach`.

### Rules

1. **Never call `mock.module()` at file top-level** — always inside `describe`-level `beforeEach`
2. **Never call `mockLogger()` / `mockDrizzle()` / `mockMessageCache()` at file top-level** — same rule
3. **No `afterAll(() => { mock.restore() })` needed** — global `afterEach` handles it
4. **Adding a new mocked module?** Add it to `tests/mock-reset.ts` originals list
5. **Mutable `let impl` pattern** — declare inside `describe`, reset in `beforeEach`

### Template for new test files

```typescript
import { mock, describe, expect, test, beforeEach } from 'bun:test'
import { mockLogger, mockDrizzle, setupTestDb } from './utils/test-helpers.js'
import { functionUnderTest } from '../src/module.js'

describe('Module', () => {
  let testDb: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    mockLogger()
    mockDrizzle()
    testDb = await setupTestDb()
  })

  test('does something', () => {
    // ...
  })
})
```
````

### Checklist for new test files

- [ ] `mock.module()` and helpers called in `beforeEach` (NOT top-level)
- [ ] Mutable `let impl` declared inside `describe`
- [ ] No `afterAll(() => { mock.restore() })` present
- [ ] If mocking a NEW module not in `mock-reset.ts`, add it there
- [ ] `bun test` (full suite) passes
- [ ] `bun test --randomize` passes

````

**Step 2: Commit**

```bash
git add tests/CLAUDE.md
git commit -m "docs(tests): update CLAUDE.md for global mock reset pattern"
````

---

## Task 13: Full validation

**Step 1: Run full test suite**

Run: `bun test`
Expected: ALL PASS

**Step 2: Run randomized**

Run: `bun test --randomize`
Expected: ALL PASS

**Step 3: Run randomized 3 times to confirm stability**

Run: `bun test --randomize && bun test --randomize && bun test --randomize`
Expected: ALL PASS on all 3 runs

**Step 4: Verify no top-level mock.module remains**

Run: `grep -rn "^void mock\.module\|^mock\.module" tests/ --include="*.test.ts" | grep -v "beforeEach\|beforeAll\|describe"`

This should return ZERO results (all mock.module calls should now be inside beforeEach/describe blocks).

Also verify no top-level helper calls remain:
Run: `grep -rn "^mockLogger()\|^mockDrizzle()\|^mockMessageCache()" tests/ --include="*.test.ts"`

Expected: ZERO results

**Step 5: Commit any remaining fixes, then tag**

```bash
git add -A
git commit -m "test: validate global mock reset — all tests pass under --randomize"
```
