# Background Events Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace fake `role: 'user'` history entries from deferred prompts with a `background_events` journal that injects unseen events as system context on the user's next message.

**Architecture:** New `background_events` SQLite table stores each deferred prompt execution. `src/deferred-prompts/background-events.ts` manages CRUD. `poller.ts` writes events instead of fake history entries. `llm-orchestrator.ts` loads and injects unseen events before each `generateText` call, then appends them to history as `role: 'system'` messages.

**Tech Stack:** Bun, Drizzle ORM (SQLite), Vercel AI SDK (`ModelMessage`), pino logger, bun:test

---

### Task 1: Migration

**Files:**

- Create: `src/db/migrations/014_background_events.ts`
- Modify: `src/db/index.ts`
- Modify: `tests/utils/test-helpers.ts`

**Step 1: Create the migration file**

```typescript
// src/db/migrations/014_background_events.ts
import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration014BackgroundEvents: Migration = {
  id: '014_background_events',
  up(db: Database): void {
    db.run(`
      CREATE TABLE background_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        prompt TEXT NOT NULL,
        response TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        injected_at TEXT
      )
    `)
    db.run('CREATE INDEX idx_background_events_user_injected ON background_events(user_id, injected_at)')
  },
}
```

**Step 2: Register migration in `src/db/index.ts`**

Add the import after migration013:

```typescript
import { migration014BackgroundEvents } from './migrations/014_background_events.js'
```

Add to the `MIGRATIONS` array after `migration013DeferredPrompts`:

```typescript
migration014BackgroundEvents,
```

**Step 3: Register migration in `tests/utils/test-helpers.ts`**

Add the import after migration013:

```typescript
import { migration014BackgroundEvents } from '../../src/db/migrations/014_background_events.js'
```

Add to `ALL_MIGRATIONS` after `migration013DeferredPrompts`:

```typescript
migration014BackgroundEvents,
```

**Step 4: Run typecheck to verify**

```bash
bun typecheck
```

Expected: no errors

**Step 5: Commit**

```bash
git add src/db/migrations/014_background_events.ts src/db/index.ts tests/utils/test-helpers.ts
git commit -m "feat: add background_events migration (014)"
```

---

### Task 2: Schema

**Files:**

- Modify: `src/db/schema.ts`

**Step 1: Add table definition and type export to `src/db/schema.ts`**

After the `taskSnapshots` table definition (around line 172), add:

```typescript
export const backgroundEvents = sqliteTable(
  'background_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    type: text('type').notNull(),
    prompt: text('prompt').notNull(),
    response: text('response').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    injectedAt: text('injected_at'),
  },
  (table) => [index('idx_background_events_user_injected').on(table.userId, table.injectedAt)],
)

export type BackgroundEventRow = typeof backgroundEvents.$inferSelect
```

**Step 2: Run typecheck**

```bash
bun typecheck
```

Expected: no errors

**Step 3: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat: add backgroundEvents Drizzle schema"
```

---

### Task 3: `background-events.ts` module

**Files:**

- Create: `src/deferred-prompts/background-events.ts`
- Create: `tests/deferred-prompts/background-events.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/deferred-prompts/background-events.test.ts
import { Database } from 'bun:sqlite'
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

import { drizzle } from 'drizzle-orm/bun-sqlite'

import * as schema from '../../src/db/schema.js'
import { mockLogger } from '../utils/test-helpers.js'

mockLogger()

let testDb: ReturnType<typeof drizzle<typeof schema>>
let testSqlite: Database

void mock.module('../../src/db/drizzle.js', () => ({
  getDrizzleDb: (): ReturnType<typeof drizzle<typeof schema>> => testDb,
}))

import {
  loadUnseenEvents,
  markEventsInjected,
  pruneBackgroundEvents,
  recordBackgroundEvent,
} from '../../src/deferred-prompts/background-events.js'

const setupDb = (): void => {
  testSqlite = new Database(':memory:')
  testSqlite.run('PRAGMA journal_mode=WAL')
  testDb = drizzle(testSqlite, { schema })
  testSqlite.run(`
    CREATE TABLE background_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      prompt TEXT NOT NULL,
      response TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      injected_at TEXT
    )
  `)
  testSqlite.run('CREATE INDEX idx_background_events_user_injected ON background_events(user_id, injected_at)')
}

beforeEach(setupDb)
afterAll(() => {
  mock.restore()
})

describe('recordBackgroundEvent', () => {
  test('inserts a row with injectedAt null', () => {
    recordBackgroundEvent('user-1', 'scheduled', 'create report', 'Created report task.')
    const rows = testSqlite
      .query<
        { user_id: string; type: string; injected_at: string | null },
        []
      >('SELECT user_id, type, injected_at FROM background_events')
      .all()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.user_id).toBe('user-1')
    expect(rows[0]!.type).toBe('scheduled')
    expect(rows[0]!.injected_at).toBeNull()
  })

  test('caps response at 2000 characters', () => {
    const longResponse = 'x'.repeat(3000)
    recordBackgroundEvent('user-1', 'alert', 'check overdue', longResponse)
    const row = testSqlite.query<{ response: string }, []>('SELECT response FROM background_events').get()
    expect(row!.response.length).toBe(2000)
  })

  test('stores full response when under 2000 characters', () => {
    recordBackgroundEvent('user-1', 'scheduled', 'do thing', 'short response')
    const row = testSqlite.query<{ response: string }, []>('SELECT response FROM background_events').get()
    expect(row!.response).toBe('short response')
  })
})

describe('loadUnseenEvents', () => {
  test('returns only rows with injectedAt null for the given user', () => {
    recordBackgroundEvent('user-1', 'scheduled', 'task A', 'Done A.')
    recordBackgroundEvent('user-1', 'alert', 'task B', 'Done B.')
    recordBackgroundEvent('user-2', 'scheduled', 'task C', 'Done C.')

    const events = loadUnseenEvents('user-1')
    expect(events).toHaveLength(2)
    expect(events.every((e) => e.userId === 'user-1')).toBe(true)
  })

  test('excludes already injected events', () => {
    recordBackgroundEvent('user-1', 'scheduled', 'old task', 'Done.')
    testSqlite.run("UPDATE background_events SET injected_at = datetime('now') WHERE user_id = 'user-1'")
    recordBackgroundEvent('user-1', 'alert', 'new task', 'Done.')

    const events = loadUnseenEvents('user-1')
    expect(events).toHaveLength(1)
    expect(events[0]!.prompt).toBe('new task')
  })

  test('returns events ordered by createdAt ascending', () => {
    testSqlite.run(`INSERT INTO background_events (id, user_id, type, prompt, response, created_at)
      VALUES ('a', 'user-1', 'scheduled', 'first', 'r', '2026-03-24T09:00:00Z')`)
    testSqlite.run(`INSERT INTO background_events (id, user_id, type, prompt, response, created_at)
      VALUES ('b', 'user-1', 'alert', 'second', 'r', '2026-03-24T09:05:00Z')`)

    const events = loadUnseenEvents('user-1')
    expect(events[0]!.prompt).toBe('first')
    expect(events[1]!.prompt).toBe('second')
  })

  test('returns empty array when no unseen events', () => {
    expect(loadUnseenEvents('user-1')).toEqual([])
  })
})

describe('markEventsInjected', () => {
  test('sets injectedAt on the specified ids', () => {
    recordBackgroundEvent('user-1', 'scheduled', 'task', 'Done.')
    const events = loadUnseenEvents('user-1')
    const ids = events.map((e) => e.id)

    markEventsInjected(ids)

    const unseen = loadUnseenEvents('user-1')
    expect(unseen).toHaveLength(0)
  })

  test('does not affect other rows', () => {
    recordBackgroundEvent('user-1', 'scheduled', 'task A', 'Done A.')
    recordBackgroundEvent('user-1', 'alert', 'task B', 'Done B.')
    const [first] = loadUnseenEvents('user-1')

    markEventsInjected([first!.id])

    const unseen = loadUnseenEvents('user-1')
    expect(unseen).toHaveLength(1)
    expect(unseen[0]!.prompt).toBe('task B')
  })

  test('no-ops on empty array', () => {
    expect(() => markEventsInjected([])).not.toThrow()
  })
})

describe('pruneBackgroundEvents', () => {
  test('deletes events older than the given days', () => {
    testSqlite.run(`INSERT INTO background_events (id, user_id, type, prompt, response, created_at, injected_at)
      VALUES ('old', 'user-1', 'scheduled', 'old task', 'Done.', datetime('now', '-31 days'), datetime('now', '-31 days'))`)
    recordBackgroundEvent('user-1', 'scheduled', 'new task', 'Done.')

    pruneBackgroundEvents(30)

    const rows = testSqlite.query<{ id: string }, []>('SELECT id FROM background_events').all()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).not.toBe('old')
  })

  test('keeps events within retention period', () => {
    recordBackgroundEvent('user-1', 'scheduled', 'recent', 'Done.')
    pruneBackgroundEvents(30)
    const rows = testSqlite.query<{ id: string }, []>('SELECT id FROM background_events').all()
    expect(rows).toHaveLength(1)
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
bun test tests/deferred-prompts/background-events.test.ts
```

Expected: FAIL — module not found

**Step 3: Implement `src/deferred-prompts/background-events.ts`**

```typescript
import { and, isNull, lt, inArray, sql } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { backgroundEvents, type BackgroundEventRow } from '../db/schema.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'deferred:background-events' })

const RESPONSE_CAP = 2000

export const recordBackgroundEvent = (
  userId: string,
  type: 'scheduled' | 'alert',
  prompt: string,
  response: string,
): void => {
  log.debug({ userId, type }, 'recordBackgroundEvent called')
  const db = getDrizzleDb()
  db.insert(backgroundEvents)
    .values({
      id: crypto.randomUUID(),
      userId,
      type,
      prompt,
      response: response.slice(0, RESPONSE_CAP),
      createdAt: new Date().toISOString(),
      injectedAt: null,
    })
    .run()
  log.info({ userId, type }, 'Background event recorded')
}

export const loadUnseenEvents = (userId: string): BackgroundEventRow[] => {
  log.debug({ userId }, 'loadUnseenEvents called')
  const db = getDrizzleDb()
  return db
    .select()
    .from(backgroundEvents)
    .where(and(sql`${backgroundEvents.userId} = ${userId}`, isNull(backgroundEvents.injectedAt)))
    .orderBy(backgroundEvents.createdAt)
    .all()
}

export const markEventsInjected = (ids: string[]): void => {
  if (ids.length === 0) return
  log.debug({ count: ids.length }, 'markEventsInjected called')
  const db = getDrizzleDb()
  db.update(backgroundEvents)
    .set({ injectedAt: new Date().toISOString() })
    .where(inArray(backgroundEvents.id, ids))
    .run()
  log.info({ count: ids.length }, 'Background events marked injected')
}

export const pruneBackgroundEvents = (olderThanDays = 30): void => {
  log.debug({ olderThanDays }, 'pruneBackgroundEvents called')
  const db = getDrizzleDb()
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString()
  db.delete(backgroundEvents).where(lt(backgroundEvents.createdAt, cutoff)).run()
  log.info({ olderThanDays }, 'Old background events pruned')
}
```

**Step 4: Run tests to verify they pass**

```bash
bun test tests/deferred-prompts/background-events.test.ts
```

Expected: all tests pass

**Step 5: Commit**

```bash
git add src/deferred-prompts/background-events.ts tests/deferred-prompts/background-events.test.ts
git commit -m "feat: add background-events module with CRUD and prune"
```

---

### Task 4: Update `poller.ts`

**Files:**

- Modify: `src/deferred-prompts/poller.ts`
- Modify: `tests/deferred-prompts/poller.test.ts`

The goal: remove `logToHistory`, replace with `recordBackgroundEvent`. On failure, also record the error event and notify the user.

**Step 1: Add failing test for error recording in poller**

Open `tests/deferred-prompts/poller.test.ts`. The file already imports `pollScheduledOnce` and `pollAlertsOnce`. Add a test that verifies a `background_events` row is written on LLM failure.

First, check the test file structure — it uses `mockDrizzle()` and `setupTestDb()`. Add at the end of the relevant describe block:

```typescript
// Near existing "pollScheduledOnce" tests, add:
describe('pollScheduledOnce — background events', () => {
  test('records event on successful scheduled prompt execution', async () => {
    const db = await setupTestDb()
    const userId = 'test-user'
    setConfig(userId, 'llm_apikey', 'key')
    setConfig(userId, 'llm_baseurl', 'http://localhost')
    setConfig(userId, 'main_model', 'gpt-4o')
    createScheduledPrompt(userId, 'create report task', new Date(Date.now() - 1000).toISOString())

    await pollScheduledOnce(mockChat, mockBuildProvider)

    const rows = db.select().from(schema.backgroundEvents).where(eq(schema.backgroundEvents.userId, userId)).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.type).toBe('scheduled')
    expect(rows[0]!.injectedAt).toBeNull()
  })

  test('records failure event and notifies user when LLM throws', async () => {
    generateTextImpl = (): Promise<GenerateTextResult> => Promise.reject(new Error('LLM down'))
    const db = await setupTestDb()
    const userId = 'fail-user'
    setConfig(userId, 'llm_apikey', 'key')
    setConfig(userId, 'llm_baseurl', 'http://localhost')
    setConfig(userId, 'main_model', 'gpt-4o')
    createScheduledPrompt(userId, 'do something', new Date(Date.now() - 1000).toISOString())

    await pollScheduledOnce(mockChat, mockBuildProvider)

    const rows = db.select().from(schema.backgroundEvents).where(eq(schema.backgroundEvents.userId, userId)).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.response).toMatch(/Failed/)
    expect(mockChat.sentMessages.some((m) => m.userId === userId)).toBe(true)
  })
})
```

**Step 2: Run new tests to verify they fail**

```bash
bun test tests/deferred-prompts/poller.test.ts
```

Expected: new tests fail (no background_events table yet in test setup, `recordBackgroundEvent` not called)

**Step 3: Modify `src/deferred-prompts/poller.ts`**

Remove the `logToHistory` import and function. Add the `recordBackgroundEvent` import:

```typescript
import { recordBackgroundEvent } from './background-events.js'
```

Replace `logToHistory` in `executeScheduledPrompt`. The current call at the end is:

```typescript
// REMOVE this function and its two call sites:
function logToHistory(userId: string, prompt: string, response: string): void {
  appendHistory(userId, [
    { role: 'user', content: prompt },
    { role: 'assistant', content: response },
  ])
}
```

In `executeScheduledPrompt`, change the success path:

```typescript
// BEFORE:
await chat.sendMessage(prompt.userId, response)
logToHistory(prompt.userId, prompt.prompt, response)

// AFTER:
await chat.sendMessage(prompt.userId, response)
recordBackgroundEvent(prompt.userId, 'scheduled', prompt.prompt, response)
```

Wrap the `invokeLlm` call in `executeScheduledPrompt` to also record failures:

```typescript
// BEFORE:
const response = await invokeLlm(prompt.userId, systemPrompt, prompt.prompt, buildProviderFn)
await chat.sendMessage(prompt.userId, response)
recordBackgroundEvent(prompt.userId, 'scheduled', prompt.prompt, response)

// AFTER:
let response: string
try {
  response = await invokeLlm(prompt.userId, systemPrompt, prompt.prompt, buildProviderFn)
} catch (error) {
  const errMsg = error instanceof Error ? error.message : String(error)
  log.error({ id: prompt.id, userId: prompt.userId, error: errMsg }, 'Scheduled prompt LLM invocation failed')
  recordBackgroundEvent(prompt.userId, 'scheduled', prompt.prompt, `Failed: ${errMsg}`)
  await chat.sendMessage(prompt.userId, `Scheduled task failed: ${errMsg}`)
  return
}
await chat.sendMessage(prompt.userId, response)
recordBackgroundEvent(prompt.userId, 'scheduled', prompt.prompt, response)
```

In `executeSingleAlert`, replace the success call and add failure handling similarly:

```typescript
// BEFORE:
const response = await invokeLlm(userId, systemPrompt, userPrompt, buildProviderFn)
await chat.sendMessage(userId, response)
logToHistory(userId, alert.prompt, response)

// AFTER:
let response: string
try {
  response = await invokeLlm(userId, systemPrompt, userPrompt, buildProviderFn)
} catch (error) {
  const errMsg = error instanceof Error ? error.message : String(error)
  log.error({ id: alert.id, userId, error: errMsg }, 'Alert prompt LLM invocation failed')
  recordBackgroundEvent(userId, 'alert', alert.prompt, `Failed: ${errMsg}`)
  await chat.sendMessage(userId, `Alert task failed: ${errMsg}`)
  return
}
await chat.sendMessage(userId, response)
recordBackgroundEvent(userId, 'alert', alert.prompt, response)
```

Also remove the now-unused `appendHistory` import from `poller.ts`.

**Step 4: Run all deferred-prompts tests**

```bash
bun test tests/deferred-prompts/
```

Expected: all pass

**Step 5: Commit**

```bash
git add src/deferred-prompts/poller.ts tests/deferred-prompts/poller.test.ts
git commit -m "feat: replace logToHistory with recordBackgroundEvent in poller"
```

---

### Task 5: Call `pruneBackgroundEvents` on startup

**Files:**

- Modify: `src/deferred-prompts/poller.ts`

**Step 1: Add prune call to `startPollers`**

In `startPollers`, add a prune call at the top of the function:

```typescript
import { pruneBackgroundEvents, recordBackgroundEvent } from './background-events.js'

export function startPollers(chat: ChatProvider, buildProviderFn: BuildProviderFn): void {
  if (scheduledIntervalId !== null || alertIntervalId !== null) {
    log.warn('startPollers called while pollers are already running; stopping existing pollers first')
    stopPollers()
  }

  pruneBackgroundEvents() // remove events older than 30 days
  // ... rest of existing code
```

**Step 2: Run typecheck**

```bash
bun typecheck
```

Expected: no errors

**Step 3: Commit**

```bash
git add src/deferred-prompts/poller.ts
git commit -m "feat: prune old background events on poller startup"
```

---

### Task 6: Inject background events in `llm-orchestrator.ts`

**Files:**

- Modify: `src/llm-orchestrator.ts`
- Modify: `tests/llm-orchestrator-process.test.ts`

**Step 1: Write failing tests**

Open `tests/llm-orchestrator-process.test.ts`. This file already mocks many modules. Add tests for background event injection.

At the top of the file, add `backgroundEvents` to the schema mock section (check the existing mocks — the file likely mocks `db/drizzle.js`). Then add:

```typescript
// Add to the existing module mocks section (after other mocks):

let unseenEventsImpl: (userId: string) => Array<{
  id: string
  userId: string
  type: string
  prompt: string
  response: string
  createdAt: string
  injectedAt: string | null
}> = () => []
const markInjectedCalls: string[][] = []

void mock.module('../../src/deferred-prompts/background-events.js', () => ({
  loadUnseenEvents: (userId: string) => unseenEventsImpl(userId),
  markEventsInjected: (ids: string[]) => {
    markInjectedCalls.push(ids)
  },
  recordBackgroundEvent: () => {},
  pruneBackgroundEvents: () => {},
}))
```

Add the tests after the existing describe blocks:

```typescript
describe('processMessage — background event injection', () => {
  beforeEach(() => {
    unseenEventsImpl = () => []
    markInjectedCalls.length = 0
  })

  test('prepends system message when unseen events exist', async () => {
    unseenEventsImpl = () => [
      {
        id: 'evt-1',
        userId: 'user-1',
        type: 'scheduled',
        prompt: 'create report',
        response: 'Created report.',
        createdAt: '2026-03-24T09:00:00Z',
        injectedAt: null,
      },
    ]

    let capturedMessages: unknown[] = []
    generateTextImpl = (args: { messages: unknown[] }): Promise<GenerateTextResult> => {
      capturedMessages = args.messages
      return Promise.resolve({ text: 'ok', toolCalls: [], toolResults: [], response: { messages: [] } })
    }

    const { reply } = createMockReply()
    await processMessage(reply, 'user-1', null, 'hello')

    const systemMessages = capturedMessages.filter((m: unknown) => (m as { role: string }).role === 'system')
    expect(systemMessages.length).toBeGreaterThanOrEqual(1)
    const bgMsg = systemMessages.find((m: unknown) =>
      (m as { content: string }).content.includes('Background tasks completed'),
    )
    expect(bgMsg).toBeDefined()
    expect((bgMsg as { content: string }).content).toContain('create report')
    expect((bgMsg as { content: string }).content).toContain('Created report.')
  })

  test('calls markEventsInjected with event ids after injection', async () => {
    unseenEventsImpl = () => [
      {
        id: 'evt-2',
        userId: 'user-1',
        type: 'alert',
        prompt: 'check overdue',
        response: '2 overdue.',
        createdAt: '2026-03-24T09:05:00Z',
        injectedAt: null,
      },
    ]

    const { reply } = createMockReply()
    await processMessage(reply, 'user-1', null, 'hello')

    expect(markInjectedCalls).toHaveLength(1)
    expect(markInjectedCalls[0]).toEqual(['evt-2'])
  })

  test('does not prepend system message when no unseen events', async () => {
    unseenEventsImpl = () => []

    let capturedMessages: unknown[] = []
    generateTextImpl = (args: { messages: unknown[] }): Promise<GenerateTextResult> => {
      capturedMessages = args.messages
      return Promise.resolve({ text: 'ok', toolCalls: [], toolResults: [], response: { messages: [] } })
    }

    const { reply } = createMockReply()
    await processMessage(reply, 'user-1', null, 'hello')

    const bgMessages = capturedMessages.filter((m: unknown) =>
      ((m as { role: string; content?: string }).content ?? '').includes('Background tasks completed'),
    )
    expect(bgMessages).toHaveLength(0)
    expect(markInjectedCalls).toHaveLength(0)
  })
})
```

**Step 2: Run failing tests**

```bash
bun test tests/llm-orchestrator-process.test.ts
```

Expected: new tests fail (injection not implemented yet)

**Step 3: Implement injection in `src/llm-orchestrator.ts`**

Add import near top:

```typescript
import { loadUnseenEvents, markEventsInjected } from './deferred-prompts/background-events.js'
import { appendHistory } from './history.js'
```

Add a helper to format the injected system message. Place this near the top of the file after the logger setup:

```typescript
const formatBackgroundEventsMessage = (
  events: Array<{ type: string; prompt: string; response: string; createdAt: string }>,
): string => {
  const lines = events.map((e) => {
    const ts = new Date(e.createdAt).toUTCString().replace(' GMT', ' UTC')
    return `[${ts} | ${e.type}] ${e.prompt}\n→ ${e.response}`
  })
  return `[Background tasks completed while you were away]\n\n${lines.join('\n\n')}`
}
```

In `callLlm`, after the `buildMessagesWithMemory` call (line ~231) and before `generateText`, add:

```typescript
const { messages: messagesWithMemory, memoryMsg } = buildMessagesWithMemory(contextId, history)

// Inject unseen background events
const unseenEvents = loadUnseenEvents(contextId)
let finalMessages = messagesWithMemory
if (unseenEvents.length > 0) {
  const bgMsg: ModelMessage = {
    role: 'system',
    content: formatBackgroundEventsMessage(unseenEvents),
  }
  finalMessages = [bgMsg, ...messagesWithMemory]
  // Persist events into history as system messages so they survive beyond this call
  const historyEntries: ModelMessage[] = unseenEvents.map((e) => ({
    role: 'system' as const,
    content: `[Background: ${e.type} | ${e.createdAt}]\n${e.prompt}\n→ ${e.response}`,
  }))
  appendHistory(contextId, historyEntries)
  markEventsInjected(unseenEvents.map((e) => e.id))
  log.info({ contextId, eventCount: unseenEvents.length }, 'Background events injected into LLM context')
}

log.debug({ contextId, historyLength: history.length, hasMemory: memoryMsg !== null, timezone }, 'Calling generateText')
const result = await generateText({
  model,
  system: buildSystemPrompt(provider, timezone, contextId),
  messages: finalMessages, // <-- was: messagesWithMemory
  tools,
  stopWhen: stepCountIs(25),
})
```

**Step 4: Run tests**

```bash
bun test tests/llm-orchestrator-process.test.ts
```

Expected: all pass including new tests

**Step 5: Run full test suite**

```bash
bun test
```

Expected: all pass

**Step 6: Commit**

```bash
git add src/llm-orchestrator.ts tests/llm-orchestrator-process.test.ts
git commit -m "feat: inject background events into LLM context on next user message"
```

---

### Task 7: Final checks

**Step 1: Typecheck**

```bash
bun typecheck
```

Expected: no errors

**Step 2: Lint**

```bash
bun lint
```

Expected: no errors

**Step 3: Full test suite**

```bash
bun test
```

Expected: all pass

**Step 4: Knip (dead code check)**

```bash
bun knip
```

Expected: no unused exports (verify `appendHistory` import removal from poller doesn't cause issues)
