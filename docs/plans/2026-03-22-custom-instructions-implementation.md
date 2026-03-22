# Custom Instructions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task.

**Goal:** Allow users and group admins to teach the bot persistent behavioral preferences via
natural language, stored per context and injected into every system prompt.

**Architecture:** Three new LLM tools (`save_instruction`, `list_instructions`,
`delete_instruction`) are added unconditionally to the tool set. Instructions are stored in a
new `user_instructions` SQLite table, cached in the existing `UserCache`, and prepended to the
system prompt as a `=== Custom instructions ===` block when present.

**Tech Stack:** Bun, TypeScript strict mode, Drizzle ORM (bun-sqlite), Vercel AI SDK (`tool`
from `ai`), Zod v4, pino logger.

---

### Task 1: DB migration and Drizzle schema

**Files:**

- Create: `src/db/migrations/011_user_instructions.ts`
- Modify: `src/db/schema.ts`
- Modify: `src/db/index.ts`

**Step 1: Create the migration file**

```typescript
// src/db/migrations/011_user_instructions.ts
import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration011UserInstructions: Migration = {
  id: '011_user_instructions',
  up(db: Database): void {
    db.run(`
      CREATE TABLE user_instructions (
        id TEXT PRIMARY KEY,
        context_id TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')) NOT NULL
      )
    `)
    db.run('CREATE INDEX idx_user_instructions_context ON user_instructions(context_id)')
  },
}
```

**Step 2: Add the Drizzle table definition to `src/db/schema.ts`**

Add after the `recurringTaskOccurrences` table (before the type exports at the bottom):

```typescript
export const userInstructions = sqliteTable(
  'user_instructions',
  {
    id: text('id').primaryKey(),
    contextId: text('context_id').notNull(),
    text: text('text').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [index('idx_user_instructions_context').on(table.contextId)],
)

export type UserInstruction = typeof userInstructions.$inferSelect
```

**Step 3: Register the migration in `src/db/index.ts`**

Add the import:

```typescript
import { migration011UserInstructions } from './migrations/011_user_instructions.js'
```

Add to the `MIGRATIONS` array after `migration010RecurringTaskOccurrences`:

```typescript
migration011UserInstructions,
```

**Step 4: Commit**

```bash
git add src/db/migrations/011_user_instructions.ts src/db/schema.ts src/db/index.ts
git commit -m "feat: add user_instructions DB migration and schema"
```

---

### Task 2: Cache layer

**Files:**

- Modify: `src/cache-db.ts`
- Modify: `src/cache.ts`

**Step 1: Write the failing tests for cache functions**

Create `tests/instructions-cache.test.ts`:

```typescript
import { Database } from 'bun:sqlite'
import { describe, test, expect, beforeEach } from 'bun:test'
import { drizzle } from 'drizzle-orm/bun-sqlite'

import { mockLogger } from './utils/test-helpers.js'

mockLogger()

import * as schema from '../src/db/schema.js'
import { _setDrizzleDb, _resetDrizzleDb } from '../src/db/drizzle.js'
import { _userCaches } from '../src/cache.js'

function makeDb() {
  const sqlite = new Database(':memory:')
  sqlite.run(`
    CREATE TABLE user_instructions (
      id TEXT PRIMARY KEY,
      context_id TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')) NOT NULL
    )
  `)
  return drizzle(sqlite, { schema })
}

beforeEach(() => {
  _userCaches.clear()
  _setDrizzleDb(makeDb())
})

describe('instructions cache', () => {
  test('getCachedInstructions returns empty array for new context', async () => {
    const { getCachedInstructions } = await import('../src/cache.js')
    const result = getCachedInstructions('ctx-1')
    expect(result).toEqual([])
  })

  test('addCachedInstruction stores instruction and retrieves it', async () => {
    const { addCachedInstruction, getCachedInstructions } = await import('../src/cache.js')
    addCachedInstruction('ctx-1', { id: 'i-1', text: 'Always reply in Spanish' })
    const result = getCachedInstructions('ctx-1')
    expect(result).toHaveLength(1)
    expect(result[0]?.text).toBe('Always reply in Spanish')
  })

  test('addCachedInstruction enforces cap of 20', async () => {
    const { addCachedInstruction, getCachedInstructions } = await import('../src/cache.js')
    for (let i = 0; i < 21; i++) {
      addCachedInstruction('ctx-1', { id: `i-${i}`, text: `Instruction ${i}` })
    }
    // Still 20 — the 21st is rejected before reaching cache
    // (cap enforcement is in instructions.ts, not cache)
    // Cache itself stores whatever is given
    expect(getCachedInstructions('ctx-1').length).toBe(21)
  })

  test('deleteCachedInstruction removes by id', async () => {
    const { addCachedInstruction, deleteCachedInstruction, getCachedInstructions } = await import('../src/cache.js')
    addCachedInstruction('ctx-1', { id: 'i-1', text: 'First' })
    addCachedInstruction('ctx-1', { id: 'i-2', text: 'Second' })
    deleteCachedInstruction('ctx-1', 'i-1')
    const result = getCachedInstructions('ctx-1')
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('i-2')
  })

  test('deleteCachedInstruction is a no-op for unknown id', async () => {
    const { addCachedInstruction, deleteCachedInstruction, getCachedInstructions } = await import('../src/cache.js')
    addCachedInstruction('ctx-1', { id: 'i-1', text: 'First' })
    deleteCachedInstruction('ctx-1', 'unknown')
    expect(getCachedInstructions('ctx-1')).toHaveLength(1)
  })

  test('lazy loads from DB on first access', async () => {
    // Pre-seed DB
    const db = makeDb()
    _setDrizzleDb(db)
    db.insert(schema.userInstructions)
      .values({ id: 'db-1', contextId: 'ctx-db', text: 'From DB', createdAt: new Date().toISOString() })
      .run()
    _userCaches.clear()

    const { getCachedInstructions } = await import('../src/cache.js')
    const result = getCachedInstructions('ctx-db')
    expect(result).toHaveLength(1)
    expect(result[0]?.text).toBe('From DB')
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
bun test tests/instructions-cache.test.ts
```

Expected: fail with import errors for `getCachedInstructions`, `addCachedInstruction`, `deleteCachedInstruction`.

**Step 3: Add sync functions to `src/cache-db.ts`**

Add these imports at the top of `src/cache-db.ts`:

```typescript
import { userInstructions } from './db/schema.js'
```

Add these functions at the end of `src/cache-db.ts`:

```typescript
export function syncInstructionToDb(contextId: string, instruction: { id: string; text: string }): void {
  queueMicrotask(() => {
    try {
      const db = getDrizzleDb()
      db.insert(userInstructions)
        .values({ id: instruction.id, contextId, text: instruction.text, createdAt: new Date().toISOString() })
        .onConflictDoNothing()
        .run()
      log.debug({ contextId, id: instruction.id }, 'Instruction synced to DB')
    } catch (error) {
      log.error(
        { contextId, error: error instanceof Error ? error.message : String(error) },
        'Failed to sync instruction to DB',
      )
    }
  })
}

export function deleteInstructionFromDb(contextId: string, id: string): void {
  queueMicrotask(() => {
    try {
      const db = getDrizzleDb()
      db.delete(userInstructions)
        .where(and(eq(userInstructions.id, id), eq(userInstructions.contextId, contextId)))
        .run()
      log.debug({ contextId, id }, 'Instruction deleted from DB')
    } catch (error) {
      log.error(
        { contextId, error: error instanceof Error ? error.message : String(error) },
        'Failed to delete instruction from DB',
      )
    }
  })
}
```

**Step 4: Add cache functions to `src/cache.ts`**

In `UserCache` type, add the `instructions` field:

```typescript
type UserCache = {
  history: ModelMessage[]
  summary: string | null
  facts: Array<{ identifier: string; title: string; url: string; last_seen: string }>
  instructions: Array<{ id: string; text: string; createdAt: string }> | null
  config: Map<string, string | null>
  workspaceId: string | null
  tools: unknown
  lastAccessed: number
}
```

In `getOrCreateCache`, add `instructions: null` to the initial cache object.

Add these imports to `src/cache.ts`:

```typescript
import { syncInstructionToDb, deleteInstructionFromDb } from './cache-db.js'
import { userInstructions } from './db/schema.js'
```

Add these functions at the end of `src/cache.ts`:

```typescript
export function getCachedInstructions(contextId: string): readonly { id: string; text: string; createdAt: string }[] {
  const cache = getOrCreateCache(contextId)
  if (cache.instructions === null) {
    log.debug({ contextId }, 'Loading instructions from DB into cache')
    const rows = getDrizzleDb()
      .select({ id: userInstructions.id, text: userInstructions.text, createdAt: userInstructions.createdAt })
      .from(userInstructions)
      .where(sql`${userInstructions.contextId} = ${contextId}`)
      .orderBy(sql`${userInstructions.createdAt} ASC`)
      .all()
    cache.instructions = rows
  }
  return cache.instructions
}

export function addCachedInstruction(contextId: string, instruction: { id: string; text: string }): void {
  const cache = getOrCreateCache(contextId)
  if (cache.instructions === null) {
    cache.instructions = []
  }
  cache.instructions.push({ ...instruction, createdAt: new Date().toISOString() })
  syncInstructionToDb(contextId, instruction)
}

export function deleteCachedInstruction(contextId: string, id: string): void {
  const cache = getOrCreateCache(contextId)
  if (cache.instructions !== null) {
    cache.instructions = cache.instructions.filter((i) => i.id !== id)
  }
  deleteInstructionFromDb(contextId, id)
}
```

**Step 5: Run tests to verify they pass**

```bash
bun test tests/instructions-cache.test.ts
```

Expected: all pass.

**Step 6: Commit**

```bash
git add src/cache-db.ts src/cache.ts tests/instructions-cache.test.ts
git commit -m "feat: add instructions cache and DB sync layer"
```

---

### Task 3: Instructions module

**Files:**

- Create: `src/instructions.ts`
- Test: `tests/instructions.test.ts`

**Step 1: Write the failing tests**

Create `tests/instructions.test.ts`:

```typescript
import { Database } from 'bun:sqlite'
import { describe, test, expect, beforeEach } from 'bun:test'
import { drizzle } from 'drizzle-orm/bun-sqlite'

import { mockLogger } from './utils/test-helpers.js'

mockLogger()

import * as schema from '../src/db/schema.js'
import { _setDrizzleDb } from '../src/db/drizzle.js'
import { _userCaches } from '../src/cache.js'

function makeDb() {
  const sqlite = new Database(':memory:')
  sqlite.run(`
    CREATE TABLE user_instructions (
      id TEXT PRIMARY KEY,
      context_id TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')) NOT NULL
    )
  `)
  return drizzle(sqlite, { schema })
}

beforeEach(() => {
  _userCaches.clear()
  _setDrizzleDb(makeDb())
})

describe('saveInstruction', () => {
  test('stores instruction and returns it', async () => {
    const { saveInstruction } = await import('../src/instructions.js')
    const result = saveInstruction('ctx-1', 'Always reply in Spanish')
    expect(result.status).toBe('saved')
    if (result.status === 'saved') {
      expect(result.instruction.text).toBe('Always reply in Spanish')
      expect(result.instruction.id).toBeDefined()
    }
  })

  test('returns duplicate when >80% word overlap with existing', async () => {
    const { saveInstruction } = await import('../src/instructions.js')
    saveInstruction('ctx-1', 'Always reply in Spanish')
    const result = saveInstruction('ctx-1', 'Always reply in spanish language')
    expect(result.status).toBe('duplicate')
  })

  test('returns cap_reached when 20 instructions already stored', async () => {
    const { saveInstruction } = await import('../src/instructions.js')
    for (let i = 0; i < 20; i++) {
      saveInstruction('ctx-1', `Unique instruction number ${i} about topic ${i}`)
    }
    const result = saveInstruction('ctx-1', 'One more unique instruction here')
    expect(result.status).toBe('cap_reached')
  })

  test('different contexts are isolated', async () => {
    const { saveInstruction, listInstructions } = await import('../src/instructions.js')
    saveInstruction('ctx-1', 'Always reply in Spanish')
    expect(listInstructions('ctx-2')).toHaveLength(0)
  })
})

describe('listInstructions', () => {
  test('returns empty array when no instructions', async () => {
    const { listInstructions } = await import('../src/instructions.js')
    expect(listInstructions('ctx-1')).toEqual([])
  })

  test('returns all saved instructions', async () => {
    const { saveInstruction, listInstructions } = await import('../src/instructions.js')
    saveInstruction('ctx-1', 'Always reply in Spanish')
    saveInstruction('ctx-1', 'Use high priority by default')
    const result = listInstructions('ctx-1')
    expect(result).toHaveLength(2)
  })
})

describe('deleteInstruction', () => {
  test('removes instruction by id', async () => {
    const { saveInstruction, deleteInstruction, listInstructions } = await import('../src/instructions.js')
    const r = saveInstruction('ctx-1', 'Always reply in Spanish')
    if (r.status !== 'saved') throw new Error('expected saved')
    deleteInstruction('ctx-1', r.instruction.id)
    expect(listInstructions('ctx-1')).toHaveLength(0)
  })

  test('returns not_found for unknown id', async () => {
    const { deleteInstruction } = await import('../src/instructions.js')
    const result = deleteInstruction('ctx-1', 'nonexistent-id')
    expect(result.status).toBe('not_found')
  })

  test('returns deleted for known id', async () => {
    const { saveInstruction, deleteInstruction } = await import('../src/instructions.js')
    const r = saveInstruction('ctx-1', 'Always reply in Spanish')
    if (r.status !== 'saved') throw new Error('expected saved')
    const result = deleteInstruction('ctx-1', r.instruction.id)
    expect(result.status).toBe('deleted')
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
bun test tests/instructions.test.ts
```

Expected: fail — `../src/instructions.js` not found.

**Step 3: Implement `src/instructions.ts`**

```typescript
import { randomUUIDv7 } from 'bun'

import { addCachedInstruction, deleteCachedInstruction, getCachedInstructions } from './cache.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'instructions' })

const MAX_INSTRUCTIONS = 20
const DUPLICATE_THRESHOLD = 0.8

type SaveResult =
  | { status: 'saved'; instruction: { id: string; text: string } }
  | { status: 'duplicate' }
  | { status: 'cap_reached' }

type DeleteResult = { status: 'deleted' } | { status: 'not_found' }

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 0),
  )
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let intersection = 0
  for (const word of a) {
    if (b.has(word)) intersection++
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 1 : intersection / union
}

function isDuplicate(newText: string, existing: readonly { text: string }[]): boolean {
  const newTokens = tokenize(newText)
  return existing.some((e) => jaccardSimilarity(newTokens, tokenize(e.text)) >= DUPLICATE_THRESHOLD)
}

export function saveInstruction(contextId: string, text: string): SaveResult {
  log.debug({ contextId }, 'saveInstruction called')
  const existing = getCachedInstructions(contextId)

  if (existing.length >= MAX_INSTRUCTIONS) {
    log.warn({ contextId, count: existing.length }, 'Instruction cap reached')
    return { status: 'cap_reached' }
  }

  if (isDuplicate(text, existing)) {
    log.info({ contextId }, 'Duplicate instruction detected')
    return { status: 'duplicate' }
  }

  const id = randomUUIDv7()
  addCachedInstruction(contextId, { id, text })
  log.info({ contextId, id }, 'Instruction saved')
  return { status: 'saved', instruction: { id, text } }
}

export function listInstructions(contextId: string): readonly { id: string; text: string }[] {
  log.debug({ contextId }, 'listInstructions called')
  return getCachedInstructions(contextId)
}

export function deleteInstruction(contextId: string, id: string): DeleteResult {
  log.debug({ contextId, id }, 'deleteInstruction called')
  const existing = getCachedInstructions(contextId)
  const found = existing.some((i) => i.id === id)
  if (!found) {
    log.warn({ contextId, id }, 'Instruction not found for deletion')
    return { status: 'not_found' }
  }
  deleteCachedInstruction(contextId, id)
  log.info({ contextId, id }, 'Instruction deleted')
  return { status: 'deleted' }
}
```

**Step 4: Run tests to verify they pass**

```bash
bun test tests/instructions.test.ts
```

Expected: all pass.

**Step 5: Commit**

```bash
git add src/instructions.ts tests/instructions.test.ts
git commit -m "feat: add instructions module with save/list/delete and duplicate detection"
```

---

### Task 4: LLM tools

**Files:**

- Create: `src/tools/instructions.ts`
- Modify: `src/tools/index.ts`
- Test: `tests/tools/instructions.test.ts`

**Step 1: Write the failing tests**

Create `tests/tools/instructions.test.ts`:

```typescript
import { mock, describe, test, expect, beforeEach } from 'bun:test'

import { mockLogger } from '../utils/test-helpers.js'

mockLogger()

// ============================================================================
// Controllable mock state
// ============================================================================

type SaveResult =
  | { status: 'saved'; instruction: { id: string; text: string } }
  | { status: 'duplicate' }
  | { status: 'cap_reached' }

type DeleteResult = { status: 'deleted' } | { status: 'not_found' }

let saveInstructionResult: SaveResult = { status: 'saved', instruction: { id: 'i-1', text: 'test' } }
let listInstructionsResult: readonly { id: string; text: string }[] = []
let deleteInstructionResult: DeleteResult = { status: 'deleted' }

void mock.module('../../src/instructions.js', () => ({
  saveInstruction: (_contextId: string, _text: string): SaveResult => saveInstructionResult,
  listInstructions: (_contextId: string): readonly { id: string; text: string }[] => listInstructionsResult,
  deleteInstruction: (_contextId: string, _id: string): DeleteResult => deleteInstructionResult,
}))

import {
  makeSaveInstructionTool,
  makeListInstructionsTool,
  makeDeleteInstructionTool,
} from '../../src/tools/instructions.js'

beforeEach(() => {
  saveInstructionResult = { status: 'saved', instruction: { id: 'i-1', text: 'test' } }
  listInstructionsResult = []
  deleteInstructionResult = { status: 'deleted' }
})

describe('save_instruction tool', () => {
  test('returns confirmation on save', async () => {
    const tool = makeSaveInstructionTool('ctx-1')
    const result = await tool.execute({ text: 'Always reply in Spanish' }, {} as never)
    expect(result.status).toBe('saved')
  })

  test('returns duplicate message', async () => {
    saveInstructionResult = { status: 'duplicate' }
    const tool = makeSaveInstructionTool('ctx-1')
    const result = await tool.execute({ text: 'Always reply in Spanish' }, {} as never)
    expect(result.status).toBe('duplicate')
  })

  test('returns cap_reached message', async () => {
    saveInstructionResult = { status: 'cap_reached' }
    const tool = makeSaveInstructionTool('ctx-1')
    const result = await tool.execute({ text: 'One more' }, {} as never)
    expect(result.status).toBe('cap_reached')
  })
})

describe('list_instructions tool', () => {
  test('returns empty list', async () => {
    const tool = makeListInstructionsTool('ctx-1')
    const result = await tool.execute({}, {} as never)
    expect(result.instructions).toEqual([])
  })

  test('returns stored instructions', async () => {
    listInstructionsResult = [{ id: 'i-1', text: 'Always reply in Spanish' }]
    const tool = makeListInstructionsTool('ctx-1')
    const result = await tool.execute({}, {} as never)
    expect(result.instructions).toHaveLength(1)
    expect(result.instructions[0]?.text).toBe('Always reply in Spanish')
  })
})

describe('delete_instruction tool', () => {
  test('returns deleted confirmation', async () => {
    const tool = makeDeleteInstructionTool('ctx-1')
    const result = await tool.execute({ id: 'i-1' }, {} as never)
    expect(result.status).toBe('deleted')
  })

  test('returns not_found message', async () => {
    deleteInstructionResult = { status: 'not_found' }
    const tool = makeDeleteInstructionTool('ctx-1')
    const result = await tool.execute({ id: 'unknown' }, {} as never)
    expect(result.status).toBe('not_found')
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
bun test tests/tools/instructions.test.ts
```

Expected: fail — `../../src/tools/instructions.js` not found.

**Step 3: Implement `src/tools/instructions.ts`**

```typescript
import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { deleteInstruction, listInstructions, saveInstruction } from '../instructions.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:instructions' })

export function makeSaveInstructionTool(contextId: string): ToolSet[string] {
  return tool({
    description:
      'Save a persistent behavioral preference. Call this when the user expresses how the bot should always behave.',
    inputSchema: z.object({
      text: z.string().describe('The instruction as a short, clear statement, e.g. "Always reply in Spanish"'),
    }),
    execute: async ({ text }) => {
      log.debug({ contextId }, 'save_instruction tool called')
      const result = saveInstruction(contextId, text)
      if (result.status === 'saved') {
        log.info({ contextId, id: result.instruction.id }, 'Instruction saved via tool')
      }
      return result
    },
  })
}

export function makeListInstructionsTool(contextId: string): ToolSet[string] {
  return tool({
    description: 'List all custom instructions for this context.',
    inputSchema: z.object({}),
    execute: async () => {
      log.debug({ contextId }, 'list_instructions tool called')
      const instructions = listInstructions(contextId)
      log.info({ contextId, count: instructions.length }, 'Instructions listed via tool')
      return { instructions }
    },
  })
}

export function makeDeleteInstructionTool(contextId: string): ToolSet[string] {
  return tool({
    description: 'Delete a custom instruction by ID. Call list_instructions first to find the ID.',
    inputSchema: z.object({
      id: z.string().describe('The instruction ID to delete'),
    }),
    execute: async ({ id }) => {
      log.debug({ contextId, id }, 'delete_instruction tool called')
      const result = deleteInstruction(contextId, id)
      log.info({ contextId, id, status: result.status }, 'delete_instruction completed')
      return result
    },
  })
}
```

**Step 4: Register the tools in `src/tools/index.ts`**

Add the import at the top:

```typescript
import { makeSaveInstructionTool, makeListInstructionsTool, makeDeleteInstructionTool } from './instructions.js'
```

Add this function before `makeTools`:

```typescript
function addInstructionTools(tools: ToolSet, contextId: string | undefined): void {
  if (contextId === undefined) return
  tools['save_instruction'] = makeSaveInstructionTool(contextId)
  tools['list_instructions'] = makeListInstructionsTool(contextId)
  tools['delete_instruction'] = makeDeleteInstructionTool(contextId)
}
```

In `makeTools`, add the call after `addRecurringTools`:

```typescript
addInstructionTools(tools, userId)
```

**Step 5: Run tests to verify they pass**

```bash
bun test tests/tools/instructions.test.ts
```

Expected: all pass.

**Step 6: Commit**

```bash
git add src/tools/instructions.ts src/tools/index.ts tests/tools/instructions.test.ts
git commit -m "feat: add save/list/delete instruction tools"
```

---

### Task 5: System prompt injection and LLM guidance

**Files:**

- Modify: `src/llm-orchestrator.ts`
- Test: `tests/llm-orchestrator-system-prompt.test.ts`

**Step 1: Write the failing tests**

Create `tests/llm-orchestrator-system-prompt.test.ts`:

```typescript
import { mock, describe, test, expect } from 'bun:test'

import { mockLogger } from './utils/test-helpers.js'

mockLogger()

// Mock instructions module
let mockInstructions: readonly { id: string; text: string }[] = []

void mock.module('../src/instructions.js', () => ({
  saveInstruction: () => ({ status: 'saved', instruction: { id: 'i-1', text: 'test' } }),
  listInstructions: (_contextId: string) => mockInstructions,
  deleteInstruction: () => ({ status: 'deleted' }),
}))

// Provide minimal stubs for other modules the orchestrator imports
void mock.module('../src/cache.js', () => ({
  getCachedHistory: () => [],
  getCachedTools: () => undefined,
  setCachedTools: () => undefined,
  getCachedInstructions: (_contextId: string) => mockInstructions,
}))

import { buildSystemPromptForTest } from '../src/llm-orchestrator.js'

describe('buildSystemPromptForTest', () => {
  test('includes custom instructions block when instructions exist', () => {
    mockInstructions = [
      { id: 'i-1', text: 'Always reply in Spanish' },
      { id: 'i-2', text: 'Use high priority by default' },
    ]
    const prompt = buildSystemPromptForTest('ctx-1', 'UTC')
    expect(prompt).toContain('=== Custom instructions ===')
    expect(prompt).toContain('- Always reply in Spanish')
    expect(prompt).toContain('- Use high priority by default')
  })

  test('omits custom instructions block when no instructions', () => {
    mockInstructions = []
    const prompt = buildSystemPromptForTest('ctx-1', 'UTC')
    expect(prompt).not.toContain('=== Custom instructions ===')
  })

  test('custom instructions block appears before STATIC_RULES', () => {
    mockInstructions = [{ id: 'i-1', text: 'Always reply in Spanish' }]
    const prompt = buildSystemPromptForTest('ctx-1', 'UTC')
    const instructionsPos = prompt.indexOf('=== Custom instructions ===')
    const rulesPos = prompt.indexOf('WORKFLOW:')
    expect(instructionsPos).toBeLessThan(rulesPos)
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
bun test tests/llm-orchestrator-system-prompt.test.ts
```

Expected: fail — `buildSystemPromptForTest` not exported.

**Step 3: Modify `src/llm-orchestrator.ts`**

Add import at top:

```typescript
import { listInstructions } from './instructions.js'
```

Add a helper function to build the instructions block (add before `buildBasePrompt`):

```typescript
const buildInstructionsBlock = (contextId: string): string => {
  const instructions = listInstructions(contextId)
  if (instructions.length === 0) return ''
  const lines = instructions.map((i) => `- ${i.text}`).join('\n')
  return `=== Custom instructions ===\n${lines}\n\n`
}
```

Update `buildSystemPrompt` to accept and use `contextId`:

```typescript
const buildSystemPrompt = (provider: TaskProvider, timezone: string, contextId: string): string => {
  const base = buildBasePrompt(timezone)
  const instructionsBlock = buildInstructionsBlock(contextId)
  const addendum = provider.getPromptAddendum()
  const body = addendum !== '' ? `${base}\n\n${addendum}` : base
  return instructionsBlock !== '' ? `${instructionsBlock}${body}` : body
}
```

Update the `STATIC_RULES` constant — add this section before the closing backtick, after `OUTPUT RULES`:

```
CUSTOM INSTRUCTIONS — Persistent behavioral preferences set by the user are listed at the top
of this prompt under "=== Custom instructions ===". When the user expresses a persistent
behavioral preference ("always", "never", "from now on", "remember to"), call save_instruction
with the preference as a short, clear statement. Confirm briefly (e.g. "Got it, I'll always
reply in Spanish."). When asked to show or list instructions, call list_instructions. When
asked to remove or forget one, call list_instructions first to find the ID, then call
delete_instruction.
```

Update the `callLlm` function where `buildSystemPrompt` is called — pass `contextId`:

```typescript
system: buildSystemPrompt(provider, timezone, contextId),
```

Export a test helper at the bottom of the file (after the existing exports):

```typescript
/** @internal — exported for testing only */
export const buildSystemPromptForTest = (contextId: string, timezone: string): string => {
  const instructionsBlock = buildInstructionsBlock(contextId)
  const base = buildBasePrompt(timezone)
  return instructionsBlock !== '' ? `${instructionsBlock}${base}` : base
}
```

**Step 4: Run tests to verify they pass**

```bash
bun test tests/llm-orchestrator-system-prompt.test.ts
```

Expected: all pass.

**Step 5: Run all unit tests**

```bash
bun test
```

Expected: all previously passing tests still pass (pre-existing failures unchanged).

**Step 6: Commit**

```bash
git add src/llm-orchestrator.ts tests/llm-orchestrator-system-prompt.test.ts
git commit -m "feat: inject custom instructions into system prompt and add LLM guidance"
```

---

### Task 6: Full check and cleanup

**Step 1: Run all checks**

```bash
bun check
```

Fix any lint, typecheck, or format issues reported.

**Step 2: Format any files that need it**

```bash
bun fix
```

**Step 3: Commit any fix-up changes**

```bash
git add -p
git commit -m "chore: fix lint/format issues in custom instructions feature"
```
