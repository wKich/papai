# Mattermost Reply Chain Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate Mattermost message caching with existing message-cache infrastructure to enable reply chain tracking.

**Architecture:** Extend the Mattermost provider's Zod schema to capture `root_id` and `parent_id`, cache each incoming message via `cacheMessage()`, and populate `replyToMessageId` in `IncomingMessage`. Follows the exact pattern used in Telegram provider.

**Tech Stack:** TypeScript, Zod, SQLite (Drizzle ORM)

---

## Task 1: Update MattermostPostSchema with Reply Fields

**Files:**

- Modify: `src/chat/mattermost/index.ts:20-26`

**Step 1: Add root_id and parent_id to schema**

```typescript
const MattermostPostSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  channel_id: z.string(),
  message: z.string(),
  user_name: z.string().optional(),
  root_id: z.string().optional(), // NEW: Root post of thread
  parent_id: z.string().optional(), // NEW: Direct parent post
})
```

**Step 2: Run typecheck**

Run: `bun typecheck`

Expected: No type errors

**Step 3: Commit**

```bash
git add src/chat/mattermost/index.ts
git commit -m "feat(mattermost): add root_id and parent_id to post schema

Enables reply chain tracking via message cache"
```

---

## Task 2: Cache Incoming Messages

**Files:**

- Modify: `src/chat/mattermost/index.ts` (add import and cache call)

**Step 1: Add cacheMessage import**

After line 3 (after logger import), add:

```typescript
import { cacheMessage } from '../../message-cache/index.js'
```

**Step 2: Cache message in handlePostedEvent**

Locate `handlePostedEvent` method (lines 133-181). After line 139 (after post validation), add caching logic:

```typescript
const postResult = MattermostPostSchema.safeParse(JSON.parse(postJson))
if (!postResult.success) return
const post = postResult.data

// Cache message for reply chain tracking
const replyToMessageId = post.parent_id || post.root_id || undefined
cacheMessage({
  messageId: post.id,
  contextId: post.channel_id,
  authorId: post.user_id,
  authorUsername: post.user_name,
  text: post.message,
  replyToMessageId,
  timestamp: Date.now(),
})
```

**Step 3: Run typecheck**

Run: `bun typecheck`

Expected: No type errors

**Step 4: Commit**

```bash
git add src/chat/mattermost/index.ts
git commit -m "feat(mattermost): cache incoming messages

- Cache every message via cacheMessage()
- Extract replyToMessageId from parent_id/root_id
- Enables reply chain building for Mattermost"
```

---

## Task 3: Populate replyToMessageId in IncomingMessage

**Files:**

- Modify: `src/chat/mattermost/index.ts:153-165`

**Step 1: Calculate replyToMessageId before creating IncomingMessage**

Before the `const msg: IncomingMessage = {` block, ensure we have the replyToMessageId:

```typescript
// Already calculated in Task 2, reuse it here
const replyToMessageId = post.parent_id || post.root_id || undefined
```

**Step 2: Add replyToMessageId to IncomingMessage**

Modify the IncomingMessage object (lines 153-165) to include replyToMessageId:

```typescript
const msg: IncomingMessage = {
  user: {
    id: post.user_id,
    username: post.user_name ?? null,
    isAdmin,
  },
  contextId: post.channel_id,
  contextType,
  isMentioned,
  text: post.message,
  commandMatch: command?.match,
  messageId: post.id,
  replyToMessageId, // NEW
}
```

**Step 3: Run typecheck**

Run: `bun typecheck`

Expected: No type errors

**Step 4: Commit**

```bash
git add src/chat/mattermost/index.ts
git commit -m "feat(mattermost): populate replyToMessageId in IncomingMessage

- Extract reply chain identifier from parent_id/root_id
- Pass to bot for reply chain tracking"
```

---

## Task 4: Write Unit Tests for Schema Parsing

**Files:**

- Create: `tests/chat/mattermost/schema.test.ts`

**Step 1: Create test file**

```typescript
import { describe, test, expect } from 'bun:test'
import { z } from 'zod'

const MattermostPostSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  channel_id: z.string(),
  message: z.string(),
  user_name: z.string().optional(),
  root_id: z.string().optional(),
  parent_id: z.string().optional(),
})

describe('MattermostPostSchema', () => {
  test('should parse basic post without reply fields', () => {
    const post = {
      id: 'post123',
      user_id: 'user456',
      channel_id: 'channel789',
      message: 'Hello world',
    }

    const result = MattermostPostSchema.safeParse(post)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.root_id).toBeUndefined()
      expect(result.data.parent_id).toBeUndefined()
    }
  })

  test('should parse reply post with root_id and parent_id', () => {
    const post = {
      id: 'reply789',
      user_id: 'user456',
      channel_id: 'channel789',
      message: 'This is a reply',
      user_name: 'testuser',
      root_id: 'root123',
      parent_id: 'parent456',
    }

    const result = MattermostPostSchema.safeParse(post)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.root_id).toBe('root123')
      expect(result.data.parent_id).toBe('parent456')
    }
  })

  test('should parse post with only root_id (thread reply)', () => {
    const post = {
      id: 'reply789',
      user_id: 'user456',
      channel_id: 'channel789',
      message: 'Thread reply',
      root_id: 'root123',
    }

    const result = MattermostPostSchema.safeParse(post)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.root_id).toBe('root123')
      expect(result.data.parent_id).toBeUndefined()
    }
  })
})
```

**Step 2: Run tests**

Run: `bun test tests/chat/mattermost/schema.test.ts`

Expected: All tests pass

**Step 3: Commit**

```bash
git add tests/chat/mattermost/schema.test.ts
git commit -m "test(mattermost): add schema parsing tests for reply fields

- Test basic post without reply fields
- Test reply post with root_id and parent_id
- Test thread reply with only root_id"
```

---

## Task 5: Write Integration Tests for Message Caching

**Files:**

- Create: `tests/chat/mattermost/reply-chain.test.ts`

**Step 1: Create integration test file**

```typescript
import { describe, test, expect, beforeEach, afterAll } from 'bun:test'
import { mock } from 'bun:test'
import { clearMessageCache, buildReplyChain } from '../../../src/message-cache/index.js'

// Mock the cache module to avoid database dependencies
void mock.module('../../../src/message-cache/cache.js', () => ({
  cacheMessage: (msg: unknown) => {
    // Simple in-memory cache for testing
    const cache = (globalThis as unknown as { testCache: Map<string, unknown> }).testCache
    if (!cache) {
      ;(globalThis as unknown as { testCache: Map<string, unknown> }).testCache = new Map()
    }
    const m = msg as { messageId: string }
    ;(globalThis as unknown as { testCache: Map<string, unknown> }).testCache.set(m.messageId, msg)
  },
  getCachedMessage: (id: string) => {
    return (globalThis as unknown as { testCache: Map<string, unknown> }).testCache?.get(id)
  },
  hasCachedMessage: () => false,
  clearMessageCache: () => {
    if ((globalThis as unknown as { testCache: Map<string, unknown> }).testCache) {
      ;(globalThis as unknown as { testCache: Map<string, unknown> }).testCache.clear()
    }
  },
  getMessageCacheSize: () => 0,
  getAllCachedMessages: () => [],
}))

describe('Mattermost Reply Chain', () => {
  beforeEach(() => {
    clearMessageCache()
    ;(globalThis as unknown as { testCache?: Map<string, unknown> }).testCache = new Map()
  })

  afterAll(() => {
    mock.restore()
  })

  test('should extract replyToMessageId from parent_id', () => {
    const post = {
      id: 'reply123',
      user_id: 'user456',
      channel_id: 'channel789',
      message: 'Reply message',
      parent_id: 'parent456',
    }

    const replyToMessageId = post.parent_id || post.root_id || undefined
    expect(replyToMessageId).toBe('parent456')
  })

  test('should extract replyToMessageId from root_id when parent_id missing', () => {
    const post = {
      id: 'reply123',
      user_id: 'user456',
      channel_id: 'channel789',
      message: 'Thread reply',
      root_id: 'root789',
    }

    const replyToMessageId = post.parent_id || post.root_id || undefined
    expect(replyToMessageId).toBe('root789')
  })

  test('should have undefined replyToMessageId for standalone post', () => {
    const post = {
      id: 'standalone123',
      user_id: 'user456',
      channel_id: 'channel789',
      message: 'Standalone message',
    }

    const replyToMessageId = post.parent_id || post.root_id || undefined
    expect(replyToMessageId).toBeUndefined()
  })
})
```

**Step 2: Run tests**

Run: `bun test tests/chat/mattermost/reply-chain.test.ts`

Expected: All tests pass

**Step 3: Commit**

```bash
git add tests/chat/mattermost/reply-chain.test.ts
git commit -m "test(mattermost): add reply chain integration tests

- Test replyToMessageId extraction from parent_id/root_id
- Test standalone messages have undefined replyToMessageId"
```

---

## Task 6: Run Full Test Suite

**Step 1: Run all tests**

Run: `bun test`

Expected: All tests pass (including existing Mattermost tests)

**Step 2: Run full check**

Run: `bun check:full`

Expected: All checks pass (lint, typecheck, format, knip, tests)

**Step 3: Commit**

```bash
git add .
git commit -m "test: verify all tests pass for Mattermost reply chain"
```

---

## Summary

### Files Modified

- `src/chat/mattermost/index.ts` - Schema update, caching integration, replyToMessageId population

### Files Created

- `tests/chat/mattermost/schema.test.ts` - Schema parsing tests
- `tests/chat/mattermost/reply-chain.test.ts` - Integration tests

### Key Features

- Mattermost messages now cached with reply metadata
- `replyToMessageId` populated from `parent_id` || `root_id`
- Full compatibility with existing chain builder
- Consistent behavior with Telegram provider

### Verification

After implementation, the following should work:

1. Mattermost messages with `parent_id` populate `replyToMessageId`
2. Messages cached and persisted to SQLite
3. `buildReplyChain()` returns correct chains for Mattermost
4. All tests pass
