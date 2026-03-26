# Telegram Reply Chain Infrastructure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement message metadata caching and reply chain building infrastructure for Telegram messages.

**Architecture:** Provider-agnostic message cache with in-memory Map + SQLite persistence via background sync. Chain builder walks backward through cached messages using `replyToMessageId`. Follows existing cache patterns in `src/cache.ts` and `src/cache-db.ts`.

**Tech Stack:** TypeScript, SQLite (Drizzle ORM), Grammy (Telegram), Zod validation

---

## Task 1: Database Schema - Message Metadata Table

**Files:**

- Create: `src/db/migrations/017_message_metadata.ts`
- Modify: `src/db/schema.ts`
- Modify: `src/db/index.ts` (import + add to MIGRATIONS)
- Modify: `tests/utils/test-helpers.ts` (import + add to ALL_MIGRATIONS)

**Step 1: Create TypeScript migration**

```typescript
// src/db/migrations/017_message_metadata.ts
import type { Database } from 'bun:sqlite'
import type { Migration } from '../migrate.js'

export const migration017MessageMetadata: Migration = {
  id: '017_message_metadata',
  up(db: Database): void {
    db.run(`
      CREATE TABLE message_metadata (
        message_id TEXT PRIMARY KEY,
        context_id TEXT NOT NULL,
        author_id TEXT,
        author_username TEXT,
        text TEXT,
        reply_to_message_id TEXT,
        timestamp INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `)
    db.run(`CREATE INDEX idx_message_metadata_context_id ON message_metadata(context_id)`)
    db.run(`CREATE INDEX idx_message_metadata_expires_at ON message_metadata(expires_at)`)
    db.run(`CREATE INDEX idx_message_metadata_reply_to ON message_metadata(reply_to_message_id)`)
  },
}
```

**Step 2: Add to Drizzle schema**

```typescript
// src/db/schema.ts (append after existing tables)
export const messageMetadata = sqliteTable(
  'message_metadata',
  {
    messageId: text('message_id').primaryKey(),
    contextId: text('context_id').notNull(),
    authorId: text('author_id'),
    authorUsername: text('author_username'),
    text: text('text'),
    replyToMessageId: text('reply_to_message_id'),
    timestamp: integer('timestamp').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [
    index('idx_message_metadata_context_id').on(table.contextId),
    index('idx_message_metadata_expires_at').on(table.expiresAt),
    index('idx_message_metadata_reply_to').on(table.replyToMessageId),
  ],
)
```

**Step 3: Register in src/db/index.ts**

Add import at the top (after line 20):

```typescript
import { migration017MessageMetadata } from './migrations/017_message_metadata.js'
```

Add to MIGRATIONS array (after line 63):

```typescript
const MIGRATIONS = [
  // ... existing migrations ...
  migration016ExecutionMetadata,
  migration017MessageMetadata, // ADD THIS LINE
] as const
```

**Step 4: Register in tests/utils/test-helpers.ts**

Add import at the top (after line 29):

```typescript
import { migration017MessageMetadata } from '../../src/db/migrations/017_message_metadata.js'
```

Add to ALL_MIGRATIONS array (after line 52):

```typescript
const ALL_MIGRATIONS: readonly Migration[] = [
  // ... existing migrations ...
  migration016ExecutionMetadata,
  migration017MessageMetadata, // ADD THIS LINE
]
```

**Step 5: Verify migration runs**

```bash
bun test tests/db/migrate.test.ts
```

**Expected:** Tests pass, migration runs successfully.

**Step 6: Commit**

```bash
git add src/db/migrations/017_message_metadata.ts src/db/schema.ts src/db/index.ts tests/utils/test-helpers.ts
git commit -m "db: add message_metadata table for reply chain tracking

- Custom TypeScript migration (017)
- Drizzle schema definition with indexes
- Registered in MIGRATIONS and ALL_MIGRATIONS arrays
- 1-week TTL via expires_at column"
```

---

## Task 2: Type Definitions - CachedMessage

**Files:**

- Create: `src/message-cache/types.ts`

**Step 1: Create types file**

```typescript
// src/message-cache/types.ts
export interface CachedMessage {
  messageId: string
  contextId: string
  authorId?: string
  authorUsername?: string
  text?: string
  replyToMessageId?: string
  timestamp: number
}

// Database row type
export interface MessageMetadataRow {
  message_id: string
  context_id: string
  author_id: string | null
  author_username: string | null
  text: string | null
  reply_to_message_id: string | null
  timestamp: number
  expires_at: number
}
```

**Step 2: Run typecheck**

```bash
bun typecheck
```

**Expected:** No type errors.

**Step 3: Commit**

```bash
git add src/message-cache/types.ts
git commit -m "types: add CachedMessage and MessageMetadataRow types"
```

---

## Task 3: Message Cache - In-Memory Cache

**Files:**

- Create: `src/message-cache/cache.ts`

**Step 1: Create cache module**

```typescript
// src/message-cache/cache.ts
import type { CachedMessage } from './types.js'

// In-memory cache: messageId -> CachedMessage
const messageCache = new Map<string, CachedMessage>()

// 1 week in milliseconds
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000

export function cacheMessage(message: CachedMessage): void {
  const now = Date.now()
  const cachedMessage: CachedMessage = {
    ...message,
    timestamp: message.timestamp ?? now,
  }

  messageCache.set(message.messageId, cachedMessage)
}

export function getCachedMessage(messageId: string): CachedMessage | undefined {
  const cached = messageCache.get(messageId)
  if (!cached) return undefined

  // Check TTL (1 week)
  const now = Date.now()
  if (now - cached.timestamp > ONE_WEEK_MS) {
    messageCache.delete(messageId)
    return undefined
  }

  return cached
}

export function hasCachedMessage(messageId: string): boolean {
  return getCachedMessage(messageId) !== undefined
}

export function getMessageCacheSize(): number {
  return messageCache.size
}

export function clearMessageCache(): void {
  messageCache.clear()
}

// For testing - get all cached messages
export function getAllCachedMessages(): CachedMessage[] {
  const now = Date.now()
  const valid: CachedMessage[] = []

  for (const [id, msg] of messageCache) {
    if (now - msg.timestamp <= ONE_WEEK_MS) {
      valid.push(msg)
    } else {
      messageCache.delete(id)
    }
  }

  return valid
}
```

**Step 2: Write test**

```typescript
// tests/message-cache/cache.test.ts
import { describe, test, expect, beforeEach } from 'bun:test'
import {
  cacheMessage,
  getCachedMessage,
  hasCachedMessage,
  clearMessageCache,
  getMessageCacheSize,
} from '../../src/message-cache/cache.js'

describe('Message Cache', () => {
  beforeEach(() => {
    clearMessageCache()
  })

  test('should cache and retrieve message', () => {
    const message = {
      messageId: '123',
      contextId: 'chat-456',
      authorId: 'user-789',
      text: 'Hello',
      timestamp: Date.now(),
    }

    cacheMessage(message)

    const retrieved = getCachedMessage('123')
    expect(retrieved).toBeDefined()
    expect(retrieved?.text).toBe('Hello')
  })

  test('should return undefined for non-existent message', () => {
    const result = getCachedMessage('non-existent')
    expect(result).toBeUndefined()
  })

  test('should track cache size', () => {
    expect(getMessageCacheSize()).toBe(0)
    cacheMessage({ messageId: '1', contextId: 'c1', timestamp: Date.now() })
    expect(getMessageCacheSize()).toBe(1)
  })

  test('should check if message is cached', () => {
    cacheMessage({ messageId: '1', contextId: 'c1', timestamp: Date.now() })
    expect(hasCachedMessage('1')).toBe(true)
    expect(hasCachedMessage('2')).toBe(false)
  })
})
```

**Step 3: Run tests**

```bash
bun test tests/message-cache/cache.test.ts
```

**Expected:** All tests pass.

**Step 4: Commit**

```bash
git add src/message-cache/cache.ts tests/message-cache/cache.test.ts
git commit -m "feat: implement in-memory message cache

- Map-based cache with 1-week TTL
- cacheMessage, getCachedMessage, hasCachedMessage
- TTL eviction on read"
```

---

## Task 4: Background Persistence - SQLite Sync

**Files:**

- Create: `src/message-cache/persistence.ts`

**Step 1: Create persistence module**

```typescript
// src/message-cache/persistence.ts
import { queueMicrotask } from 'node:process'
import { sql } from 'drizzle-orm'
import { getDrizzleDb } from '../db/drizzle.js'
import { messageMetadata } from '../db/schema.js'
import type { CachedMessage } from './types.js'
import { logger } from '../logger.js'

// Queue for pending writes
const pendingWrites = new Map<string, CachedMessage>()
let isFlushScheduled = false

// 1 week in milliseconds
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000

export function scheduleMessagePersistence(message: CachedMessage): void {
  pendingWrites.set(message.messageId, message)
  scheduleFlush()
}

function scheduleFlush(): void {
  if (isFlushScheduled) return
  isFlushScheduled = true
  queueMicrotask(() => {
    isFlushScheduled = false
    flushPendingWrites().catch((err) => {
      logger.error({ error: err }, 'Failed to flush message cache to database')
    })
  })
}

async function flushPendingWrites(): Promise<void> {
  if (pendingWrites.size === 0) return

  const writes = Array.from(pendingWrites.values())
  pendingWrites.clear()

  const db = getDrizzleDb()
  const now = Date.now()

  try {
    await db
      .insert(messageMetadata)
      .values(
        writes.map((msg) => ({
          messageId: msg.messageId,
          contextId: msg.contextId,
          authorId: msg.authorId ?? null,
          authorUsername: msg.authorUsername ?? null,
          text: msg.text ?? null,
          replyToMessageId: msg.replyToMessageId ?? null,
          timestamp: msg.timestamp,
          expiresAt: msg.timestamp + ONE_WEEK_MS,
        })),
      )
      .onConflictDoUpdate({
        target: messageMetadata.messageId,
        set: {
          contextId: sql.raw('excluded.context_id'),
          authorId: sql.raw('excluded.author_id'),
          authorUsername: sql.raw('excluded.author_username'),
          text: sql.raw('excluded.text'),
          replyToMessageId: sql.raw('excluded.reply_to_message_id'),
          timestamp: sql.raw('excluded.timestamp'),
          expiresAt: sql.raw('excluded.expires_at'),
        },
      })

    logger.debug({ count: writes.length }, 'Persisted messages to database')
  } catch (err) {
    logger.error({ error: err, count: writes.length }, 'Failed to persist messages')
    // Re-queue failed writes
    for (const msg of writes) {
      pendingWrites.set(msg.messageId, msg)
    }
  }
}

export async function loadMessagesFromDb(contextId: string): Promise<CachedMessage[]> {
  const db = getDrizzleDb()
  const now = Date.now()

  const rows = await db
    .select()
    .from(messageMetadata)
    .where((fields) => and(eq(fields.contextId, contextId), gt(fields.expiresAt, now)))

  return rows.map((row) => ({
    messageId: row.message_id,
    contextId: row.context_id,
    authorId: row.author_id ?? undefined,
    authorUsername: row.author_username ?? undefined,
    text: row.text ?? undefined,
    replyToMessageId: row.reply_to_message_id ?? undefined,
    timestamp: row.timestamp,
  }))
}

export async function cleanupExpiredMessages(): Promise<void> {
  const db = getDrizzleDb()
  const now = Date.now()

  try {
    await db.delete(messageMetadata).where(lte(messageMetadata.expiresAt, now))
    logger.debug('Cleaned up expired message metadata')
  } catch (err) {
    logger.error({ error: err }, 'Failed to cleanup expired messages')
  }
}
```

**Step 2: Update cache.ts to integrate persistence**

```typescript
// src/message-cache/cache.ts
import { scheduleMessagePersistence } from './persistence.js'

export function cacheMessage(message: CachedMessage): void {
  const now = Date.now()
  const cachedMessage: CachedMessage = {
    ...message,
    timestamp: message.timestamp ?? now,
  }

  messageCache.set(message.messageId, cachedMessage)
  scheduleMessagePersistence(cachedMessage)
}
```

**Step 3: Write tests**

```typescript
// tests/message-cache/persistence.test.ts
import { describe, test, expect, beforeEach } from 'bun:test'
import { mockDrizzle, mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('Message Persistence', () => {
  let testDb: ReturnType<typeof setupTestDb>

  beforeEach(() => {
    testDb = setupTestDb()
    mockDrizzle(testDb.db)
    mockLogger()
  })

  test('should schedule writes to database', async () => {
    // Test that scheduleMessagePersistence queues writes
  })

  test('should load messages from database', async () => {
    // Test loadMessagesFromDb
  })

  test('should cleanup expired messages', async () => {
    // Test cleanupExpiredMessages
  })
})
```

**Step 4: Run tests**

```bash
bun test tests/message-cache/persistence.test.ts
```

**Step 5: Commit**

```bash
git add src/message-cache/persistence.ts tests/message-cache/persistence.test.ts
git commit -m "feat: add SQLite persistence for message cache

- Background sync via queueMicrotask
- Upsert on conflict
- Load from DB on demand
- Cleanup expired messages"
```

---

## Task 5: Chain Builder

**Files:**

- Create: `src/message-cache/chain.ts`
- Test: `tests/message-cache/chain.test.ts`

**Step 1: Create chain builder**

```typescript
// src/message-cache/chain.ts
import { getCachedMessage } from './cache.js'
import { logger } from '../logger.js'

export interface ReplyChainResult {
  chain: string[]
  isComplete: boolean
  brokenAt?: string
}

export function buildReplyChain(messageId: string, visited: Set<string> = new Set()): ReplyChainResult {
  const chain: string[] = []
  let currentId: string | undefined = messageId
  let isComplete = true
  let brokenAt: string | undefined

  while (currentId) {
    // Cycle detection
    if (visited.has(currentId)) {
      logger.error({ messageId: currentId, chain }, 'Circular reference detected in reply chain')
      isComplete = false
      brokenAt = currentId
      break
    }

    visited.add(currentId)
    chain.push(currentId)

    const message = getCachedMessage(currentId)
    if (!message) {
      // Message not in cache - chain is broken
      isComplete = false
      brokenAt = currentId
      logger.warn({ messageId: currentId }, 'Message not in cache, stopping chain build')
      break
    }

    if (!message.replyToMessageId) {
      // Reached root message
      break
    }

    currentId = message.replyToMessageId
  }

  // Return in chronological order (oldest first)
  return {
    chain: chain.reverse(),
    isComplete,
    brokenAt,
  }
}

export function buildReplyChainAsync(messageId: string): Promise<ReplyChainResult> {
  return Promise.resolve(buildReplyChain(messageId))
}
```

**Step 2: Write tests**

```typescript
// tests/message-cache/chain.test.ts
import { describe, test, expect, beforeEach } from 'bun:test'
import { buildReplyChain, buildReplyChainAsync } from '../../src/message-cache/chain.js'
import { cacheMessage, clearMessageCache } from '../../src/message-cache/cache.js'

describe('Reply Chain Builder', () => {
  beforeEach(() => {
    clearMessageCache()
  })

  test('should build linear chain', () => {
    // A -> B -> C
    cacheMessage({ messageId: 'A', contextId: 'c1', timestamp: Date.now() })
    cacheMessage({ messageId: 'B', contextId: 'c1', replyToMessageId: 'A', timestamp: Date.now() })
    cacheMessage({ messageId: 'C', contextId: 'c1', replyToMessageId: 'B', timestamp: Date.now() })

    const result = buildReplyChain('C')
    expect(result.chain).toEqual(['A', 'B', 'C'])
    expect(result.isComplete).toBe(true)
  })

  test('should detect missing parent', () => {
    cacheMessage({ messageId: 'C', contextId: 'c1', replyToMessageId: 'B', timestamp: Date.now() })

    const result = buildReplyChain('C')
    expect(result.chain).toEqual(['C'])
    expect(result.isComplete).toBe(false)
    expect(result.brokenAt).toBe('B')
  })

  test('should detect circular reference', () => {
    cacheMessage({ messageId: 'A', contextId: 'c1', replyToMessageId: 'C', timestamp: Date.now() })
    cacheMessage({ messageId: 'B', contextId: 'c1', replyToMessageId: 'A', timestamp: Date.now() })
    cacheMessage({ messageId: 'C', contextId: 'c1', replyToMessageId: 'B', timestamp: Date.now() })

    const result = buildReplyChain('C')
    expect(result.chain).toEqual(['A', 'B', 'C'])
    expect(result.isComplete).toBe(false)
  })

  test('should handle single message (no replies)', () => {
    cacheMessage({ messageId: 'A', contextId: 'c1', timestamp: Date.now() })

    const result = buildReplyChain('A')
    expect(result.chain).toEqual(['A'])
    expect(result.isComplete).toBe(true)
  })

  test('should work with async version', async () => {
    cacheMessage({ messageId: 'A', contextId: 'c1', timestamp: Date.now() })
    cacheMessage({ messageId: 'B', contextId: 'c1', replyToMessageId: 'A', timestamp: Date.now() })

    const result = await buildReplyChainAsync('B')
    expect(result.chain).toEqual(['A', 'B'])
  })
})
```

**Step 3: Run tests**

```bash
bun test tests/message-cache/chain.test.ts
```

**Expected:** All tests pass.

**Step 4: Commit**

```bash
git add src/message-cache/chain.ts tests/message-cache/chain.test.ts
git commit -m "feat: implement reply chain builder

- buildReplyChain walks backward through cached messages
- Returns chain in chronological order (oldest first)
- Cycle detection and broken chain handling"
```

---

## Task 6: Main Message Cache Index

**Files:**

- Create: `src/message-cache/index.ts`

**Step 1: Create module index**

```typescript
// src/message-cache/index.ts
export { cacheMessage, getCachedMessage, hasCachedMessage } from './cache.js'
export { buildReplyChain, buildReplyChainAsync } from './chain.js'
export { scheduleMessagePersistence, loadMessagesFromDb } from './persistence.js'
export type { CachedMessage, MessageMetadataRow } from './types.js'
export type { ReplyChainResult } from './chain.js'
```

**Step 2: Run typecheck**

```bash
bun typecheck
```

**Step 3: Commit**

```bash
git add src/message-cache/index.ts
git commit -m "feat: add message-cache module index exports"
```

---

## Task 7: Update Chat Types

**Files:**

- Modify: `src/chat/types.ts`

**Step 1: Add replyToMessageId to IncomingMessage**

```typescript
// src/chat/types.ts
export type IncomingMessage = {
  user: ChatUser
  contextId: string
  contextType: ContextType
  isMentioned: boolean
  text: string
  commandMatch?: string
  messageId?: string
  replyToMessageId?: string // NEW: Parent message ID if this is a reply
}
```

**Step 2: Run typecheck**

```bash
bun typecheck
```

**Step 3: Commit**

```bash
git add src/chat/types.ts
git commit -m "types: add replyToMessageId to IncomingMessage

Enables reply chain tracking for telegram and future providers"
```

---

## Task 8: Telegram Provider Integration

**Files:**

- Modify: `src/chat/telegram/index.ts`
- Modify: `src/chat/telegram/extract-message.ts` (if exists, otherwise inline in index.ts)

**Step 1: Update extractMessage to cache and return replyToMessageId**

```typescript
// src/chat/telegram/index.ts
import { cacheMessage } from '../../message-cache/index.js'

// In extractMessage function (around line 106-130)
function extractMessage(ctx: Context, isAdmin: boolean): IncomingMessage {
  const message = ctx.message
  if (!message) throw new Error('No message in context')

  const userId = message.from?.id
  const username = message.from?.username ?? `user_${userId}`
  const chatId = ctx.chat?.id

  if (!userId || !chatId) {
    throw new Error('Missing user or chat ID')
  }

  const contextId = ctx.chat?.type === 'private' ? String(userId) : String(chatId)
  const contextType = ctx.chat?.type === 'private' ? 'dm' : 'group'
  const isMentioned = message.text?.includes(`@${ctx.me?.username}`) ?? false
  const text = message.text ?? ''
  const messageId = String(message.message_id)
  const replyToMessageId = message.reply_to_message?.message_id
    ? String(message.reply_to_message.message_id)
    : undefined

  // Cache message metadata for reply chain tracking
  cacheMessage({
    messageId,
    contextId,
    authorId: String(userId),
    authorUsername: username,
    text,
    replyToMessageId,
    timestamp: Date.now(),
  })

  return {
    user: { id: String(userId), username, isAdmin },
    contextId,
    contextType,
    isMentioned,
    text,
    messageId,
    replyToMessageId,
  }
}
```

**Step 2: Run typecheck**

```bash
bun typecheck
```

**Step 3: Run existing tests**

```bash
bun test tests/chat/telegram/
```

**Expected:** All existing tests pass.

**Step 4: Commit**

```bash
git add src/chat/telegram/index.ts
git commit -m "feat(telegram): extract and cache reply metadata

- Extract reply_to_message.message_id
- Cache message metadata on every incoming message
- Add replyToMessageId to IncomingMessage"
```

---

## Task 9: Integration Tests

**Files:**

- Create: `tests/message-cache/integration.test.ts`

**Step 1: Create integration test**

```typescript
// tests/message-cache/integration.test.ts
import { describe, test, expect, beforeEach } from 'bun:test'
import { cacheMessage, buildReplyChain, clearMessageCache } from '../../src/message-cache/index.js'

describe('Message Cache Integration', () => {
  beforeEach(() => {
    clearMessageCache()
  })

  test('should cache telegram-style messages and build chain', () => {
    // Simulate telegram message flow
    cacheMessage({
      messageId: '100',
      contextId: 'chat-1',
      authorId: 'user-1',
      authorUsername: 'alice',
      text: 'Original message',
      timestamp: Date.now(),
    })

    cacheMessage({
      messageId: '101',
      contextId: 'chat-1',
      authorId: 'user-2',
      authorUsername: 'bob',
      text: 'Reply to alice',
      replyToMessageId: '100',
      timestamp: Date.now(),
    })

    cacheMessage({
      messageId: '102',
      contextId: 'chat-1',
      authorId: 'user-1',
      authorUsername: 'alice',
      text: 'Reply to bob',
      replyToMessageId: '101',
      timestamp: Date.now(),
    })

    const result = buildReplyChain('102')
    expect(result.chain).toEqual(['100', '101', '102'])
    expect(result.isComplete).toBe(true)
  })

  test('should handle deep chains', () => {
    // Build chain of 10 messages
    for (let i = 0; i < 10; i++) {
      cacheMessage({
        messageId: String(i),
        contextId: 'chat-1',
        authorId: 'user-1',
        text: `Message ${i}`,
        replyToMessageId: i > 0 ? String(i - 1) : undefined,
        timestamp: Date.now(),
      })
    }

    const result = buildReplyChain('9')
    expect(result.chain).toHaveLength(10)
    expect(result.chain[0]).toBe('0')
    expect(result.chain[9]).toBe('9')
  })
})
```

**Step 2: Run tests**

```bash
bun test tests/message-cache/integration.test.ts
```

**Step 3: Commit**

```bash
git add tests/message-cache/integration.test.ts
git commit -m "test: add integration tests for message cache

- End-to-end telegram-style flow
- Deep chain verification"
```

---

## Task 10: Run Full Test Suite

**Step 1: Run all tests**

```bash
bun test
```

**Expected:** All tests pass.

**Step 2: Run full check**

```bash
bun check:full
```

**Expected:** All checks pass (lint, typecheck, format, knip, tests).

**Step 3: Commit**

```bash
git add .
git commit -m "chore: ensure all tests and checks pass"
```

---

## Summary

### Files Created

- `src/message-cache/types.ts` - Type definitions
- `src/message-cache/cache.ts` - In-memory cache with TTL
- `src/message-cache/persistence.ts` - SQLite background sync
- `src/message-cache/chain.ts` - Reply chain builder
- `src/message-cache/index.ts` - Module exports
- `drizzle/migrations/0005_message_metadata.sql` - Database migration
- `tests/message-cache/cache.test.ts` - Cache unit tests
- `tests/message-cache/persistence.test.ts` - Persistence tests
- `tests/message-cache/chain.test.ts` - Chain builder tests
- `tests/message-cache/integration.test.ts` - Integration tests

### Files Modified

- `src/db/schema.ts` - Add messageMetadata table
- `src/chat/types.ts` - Add replyToMessageId to IncomingMessage
- `src/chat/telegram/index.ts` - Extract and cache reply metadata

### Key Features

- Provider-agnostic message cache infrastructure
- 1-week TTL with automatic eviction
- Background SQLite persistence
- Cycle detection in reply chains
- Graceful handling of missing messages

The infrastructure is now ready for the Message Reply & Quote Context feature to build `chainSummary` from cached messages.
