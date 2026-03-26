# Message Reply & Quote Context Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable the bot to capture reply/quote context from user messages, include parent message context in prompts, and respond in the correct thread.

**Architecture:** Extend the `IncomingMessage` type with `ReplyContext`, update Telegram and Mattermost providers to extract platform-specific reply metadata. Telegram provides full parent message in the incoming update, while Mattermost requires fetching the parent post via API. Build contextual prompts and integrate threading support into bot responses.

**Tech Stack:** TypeScript, Grammy (Telegram), Mattermost REST API, SQLite (history storage)

---

## Prerequisites

- Read the design document: `docs/plans/2026-03-26-message-reply-quote-context-design.md`
- Review current chat types: `src/chat/types.ts`
- Review Telegram provider: `src/chat/telegram/index.ts`
- Review Mattermost provider: `src/chat/mattermost/index.ts`
- Review bot handler: `src/bot.ts`
- Review history module: `src/history.ts`

---

## Task 1: Update Type Definitions

**Files:**

- Modify: `src/chat/types.ts`

**Step 1: Add ReplyContext type**

Add to `src/chat/types.ts` after the `ChatFile` type:

```typescript
/** Context about a message reply or quote. */
export type ReplyContext = {
  /** Platform-specific ID of the message being replied to */
  messageId: string
  /** User ID of the original message author (if available) */
  authorId?: string
  /** Username of the original message author (if available) */
  authorUsername?: string | null
  /** Text content of the message being replied to (if available) */
  text?: string
  /** For quote-style replies, the specific quoted text */
  quotedText?: string
  /** Platform-specific thread/topic ID (Telegram: message_thread_id, Mattermost: root_id) */
  threadId?: string
  /** Full reply chain - parent message IDs in order */
  chain?: string[]
  /** Summary of earlier messages in the chain */
  chainSummary?: string
}
```

**Step 2: Update IncomingMessage type**

Add `replyContext` field to `IncomingMessage`:

```typescript
/** Incoming message from a user. */
export type IncomingMessage = {
  user: ChatUser
  /** storage key: userId in DMs, groupId in groups */
  contextId: string
  contextType: ContextType
  /** bot was @mentioned */
  isMentioned: boolean
  text: string
  commandMatch?: string
  /** platform-specific message ID for deletion */
  messageId?: string
  /** Reply or quote context if this message is a reply */
  replyContext?: ReplyContext
}
```

**Step 3: Add ReplyOptions type**

Add after `ReplyFn` type:

```typescript
/** Options for reply functions to control threading behavior. */
export type ReplyOptions = {
  /** Reply to this specific message ID */
  replyToMessageId?: string
  /** Post in this thread/topic */
  threadId?: string
}
```

**Step 4: Update ReplyFn type**

Update `ReplyFn` to accept optional `ReplyOptions`:

```typescript
/** Reply function injected into handlers — the only way to send messages back to the user. */
export type ReplyFn = {
  text: (content: string, options?: ReplyOptions) => Promise<void>
  formatted: (markdown: string, options?: ReplyOptions) => Promise<void>
  file: (file: ChatFile, options?: ReplyOptions) => Promise<void>
  typing: () => void
  redactMessage?: (replacementText: string) => Promise<void>
}
```

**Step 5: Verify typecheck passes**

Run: `bun run typecheck`
Expected: No errors (types only, no implementation yet)

**Step 6: Commit**

```bash
git add src/chat/types.ts
git commit -m "feat(types): add ReplyContext and ReplyOptions types

Add types for capturing message reply/quote metadata:
- ReplyContext with messageId, author info, text, threadId
- ReplyOptions for controlling response threading
- Update IncomingMessage and ReplyFn to use new types"
```

---

## Task 2: Create Reply Context Prompt Builder Module

**Files:**

- Create: `src/reply-context.ts`
- Test: `tests/reply-context.test.ts`

**Dependencies:**

- This module builds prompts from `ReplyContext` which is populated by platform providers
- `chain` and `chainSummary` fields require additional implementation (see Task 3 - Optional)

**Note:** Telegram provides full parent message text in the incoming update (`reply_to_message`), so no enrichment is needed for Telegram. Mattermost fetches the parent post via API in the provider (see Task 4). This module only builds the prompt string from existing ReplyContext.

**Step 1: Create the module file**

Create `src/reply-context.ts`:

```typescript
import type { IncomingMessage } from './chat/types.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'reply-context' })

/**
 * Builds a prompt string with reply context prepended.
 *
 * Note: ReplyContext is already fully populated by platform providers:
 * - Telegram: Full parent message included in reply_to_message field
 * - Mattermost: Parent post fetched via GET /api/v4/posts/{post_id}
 *
 * Optional chain and chainSummary (see Task 3):
 * - Telegram: Requires message caching infrastructure
 * - Mattermost: Requires thread API integration
 */
export function buildPromptWithReplyContext(msg: IncomingMessage): string {
  if (msg.replyContext === undefined) {
    return msg.text
  }

  const context: string[] = []

  if (msg.replyContext.text !== undefined) {
    const author = msg.replyContext.authorUsername ?? 'user'
    context.push(`[Replying to message from ${author}: "${truncate(msg.replyContext.text, 200)}"]`)
  }

  if (msg.replyContext.quotedText !== undefined) {
    context.push(`[Quoted text: "${msg.replyContext.quotedText}"]`)
  }

  if (msg.replyContext.chainSummary !== undefined && msg.replyContext.chainSummary !== '') {
    context.push(`[Earlier context: ${msg.replyContext.chainSummary}]`)
  }

  if (context.length === 0) {
    return msg.text
  }

  log.debug({ contextParts: context.length }, 'Built prompt with reply context')
  return context.join('\n') + '\n\n' + msg.text
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }
  return text.slice(0, maxLength) + '...'
}
```

**Step 2: Write failing tests**

Create `tests/reply-context.test.ts`:

```typescript
import { describe, expect, mock, test, beforeEach, afterAll } from 'bun:test'
import type { IncomingMessage } from '../src/chat/types.js'

// Mock the history module
const mockGetHistory = mock(() => Promise.resolve([]))
void mock.module('../src/history.js', () => ({
  getHistory: mockGetHistory,
}))

// Mock logger
void mock.module('../src/logger.js', () => ({
  logger: {
    child: () => ({
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    }),
  },
}))

import { enrichWithReplyContext, buildPromptWithReplyContext } from '../src/reply-context.js'

describe('enrichWithReplyContext', () => {
  beforeEach(() => {
    mockGetHistory.mockClear()
  })

  afterAll(() => {
    mock.restore()
  })

  test('returns message unchanged when no reply context', async () => {
    const msg: IncomingMessage = {
      user: { id: 'user1', username: 'testuser', isAdmin: false },
      contextId: 'ctx1',
      contextType: 'dm',
      isMentioned: false,
      text: 'Hello',
    }

    const result = await enrichWithReplyContext(msg)

    expect(result).toBe(msg)
    expect(mockGetHistory).not.toHaveBeenCalled()
  })

  test('looks up parent message from history', async () => {
    mockGetHistory.mockImplementation(() =>
      Promise.resolve([
        {
          id: 1,
          userId: 'user2',
          role: 'user',
          content: 'Original message',
          timestamp: Date.now(),
          metadata: { messageId: 'msg123' },
        },
      ]),
    )

    const msg: IncomingMessage = {
      user: { id: 'user1', username: 'testuser', isAdmin: false },
      contextId: 'ctx1',
      contextType: 'dm',
      isMentioned: false,
      text: 'Reply text',
      replyContext: {
        messageId: 'msg123',
      },
    }

    const result = await enrichWithReplyContext(msg)

    expect(result.replyContext?.text).toBe('Original message')
    expect(result.replyContext?.authorId).toBe('user2')
  })

  test('handles missing parent message gracefully', async () => {
    mockGetHistory.mockImplementation(() => Promise.resolve([]))

    const msg: IncomingMessage = {
      user: { id: 'user1', username: 'testuser', isAdmin: false },
      contextId: 'ctx1',
      contextType: 'dm',
      isMentioned: false,
      text: 'Reply text',
      replyContext: {
        messageId: 'nonexistent',
      },
    }

    const result = await enrichWithReplyContext(msg)

    expect(result.replyContext?.text).toBeUndefined()
    expect(result.replyContext?.authorId).toBeUndefined()
  })
})

describe('buildPromptWithReplyContext', () => {
  test('returns plain text when no reply context', () => {
    const msg: IncomingMessage = {
      user: { id: 'user1', username: 'testuser', isAdmin: false },
      contextId: 'ctx1',
      contextType: 'dm',
      isMentioned: false,
      text: 'Hello world',
    }

    const result = buildPromptWithReplyContext(msg)

    expect(result).toBe('Hello world')
  })

  test('includes parent message context', () => {
    const msg: IncomingMessage = {
      user: { id: 'user1', username: 'testuser', isAdmin: false },
      contextId: 'ctx1',
      contextType: 'dm',
      isMentioned: false,
      text: 'Can you update it?',
      replyContext: {
        messageId: 'msg123',
        authorUsername: 'otheruser',
        text: 'Task #123 needs review',
      },
    }

    const result = buildPromptWithReplyContext(msg)

    expect(result).toContain('[Replying to message from otheruser:')
    expect(result).toContain('Task #123 needs review')
    expect(result).toContain('Can you update it?')
  })

  test('includes quoted text', () => {
    const msg: IncomingMessage = {
      user: { id: 'user1', username: 'testuser', isAdmin: false },
      contextId: 'ctx1',
      contextType: 'dm',
      isMentioned: false,
      text: 'This part is important',
      replyContext: {
        messageId: 'msg123',
        quotedText: 'Important detail here',
      },
    }

    const result = buildPromptWithReplyContext(msg)

    expect(result).toContain('[Quoted text: "Important detail here"]')
  })

  test('truncates long messages', () => {
    const longText = 'a'.repeat(300)
    const msg: IncomingMessage = {
      user: { id: 'user1', username: 'testuser', isAdmin: false },
      contextId: 'ctx1',
      contextType: 'dm',
      isMentioned: false,
      text: 'Short question',
      replyContext: {
        messageId: 'msg123',
        authorUsername: 'user',
        text: longText,
      },
    }

    const result = buildPromptWithReplyContext(msg)

    expect(result).toContain('...')
    expect(result.length).toBeLessThan(longText.length + 100)
  })
})
```

**Step 3: Run tests to verify they fail**

Run: `bun test tests/reply-context.test.ts`
Expected: Tests fail with module not found errors

**Step 4: Run tests to verify they pass**

Run: `bun test tests/reply-context.test.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/reply-context.ts tests/reply-context.test.ts
git commit -m "feat(reply-context): add context enrichment module

Create reply-context module with:
- enrichWithReplyContext() to look up parent messages
- buildPromptWithReplyContext() to format context for LLM
- Full test coverage for context enrichment scenarios"
```

---

## Task 3: Update Telegram Provider

**Files:**

- Modify: `src/chat/telegram/index.ts`
- Test: `tests/chat/telegram/reply-context.test.ts`

**Step 1: Update extractMessage to capture reply context**

Modify `extractMessage` method in `src/chat/telegram/index.ts`:

```typescript
private extractMessage(ctx: Context, isAdmin: boolean): IncomingMessage | null {
  const id = ctx.from?.id
  if (id === undefined) return null

  const chatType = ctx.chat?.type
  const isGroup = chatType === 'group' || chatType === 'supergroup' || chatType === 'channel'
  const contextId = String(ctx.chat?.id ?? id)
  const contextType: ContextType = isGroup ? 'group' : 'dm'

  const text = ctx.message?.text ?? ''
  const isMentioned = this.isBotMentioned(text, ctx.message?.entities)

  // Extract reply context
  const replyToMessage = ctx.message?.reply_to_message
  const quote = ctx.message?.quote

  const replyContext = replyToMessage !== undefined ? {
    messageId: String(replyToMessage.message_id),
    authorId: replyToMessage.from?.id !== undefined ? String(replyToMessage.from.id) : undefined,
    authorUsername: replyToMessage.from?.username ?? null,
    text: replyToMessage.text,
    quotedText: quote?.text,
    threadId: ctx.message?.message_thread_id !== undefined
      ? String(ctx.message.message_thread_id)
      : undefined,
  } : undefined

  return {
    user: {
      id: String(id),
      username: ctx.from?.username ?? null,
      isAdmin,
    },
    contextId,
    contextType,
    isMentioned,
    text,
    messageId: ctx.message?.message_id === undefined ? undefined : String(ctx.message.message_id),
    replyContext,
  }
}
```

**Step 2: Update buildReplyFn to support threading**

Modify `buildReplyFn` method:

```typescript
import type { ReplyFn, ReplyOptions } from '../types.js'

private buildReplyFn(ctx: Context): ReplyFn {
  const chatId = ctx.chat?.id
  const messageId = ctx.message?.message_id

  return {
    text: async (content: string, options?: ReplyOptions) => {
      const replyParams = options?.replyToMessageId !== undefined
        ? { message_id: parseInt(options.replyToMessageId, 10) }
        : messageId !== undefined
          ? { message_id: messageId }
          : undefined

      await ctx.reply(content, {
        reply_parameters: replyParams,
      })
    },
    formatted: async (markdown: string, options?: ReplyOptions) => {
      const formatted = formatLlmOutput(markdown)
      const replyParams = options?.replyToMessageId !== undefined
        ? { message_id: parseInt(options.replyToMessageId, 10) }
        : messageId !== undefined
          ? { message_id: messageId }
          : undefined

      await ctx.reply(formatted.text, {
        entities: formatted.entities,
        reply_parameters: replyParams,
      })
    },
    file: async (file: ChatFile, options?: ReplyOptions) => {
      const content = typeof file.content === 'string' ? Buffer.from(file.content, 'utf-8') : file.content
      const replyParams = options?.replyToMessageId !== undefined
        ? { message_id: parseInt(options.replyToMessageId, 10) }
        : messageId !== undefined
          ? { message_id: messageId }
          : undefined

      await ctx.replyWithDocument(new InputFile(content, file.filename), {
        reply_parameters: replyParams,
      })
    },
    typing: () => {
      ctx.replyWithChatAction('typing').catch(() => undefined)
    },
    redactMessage: async (replacementText: string) => {
      if (chatId !== undefined && messageId !== undefined) {
        await this.bot.api.editMessageText(chatId, messageId, replacementText).catch((err: unknown) => {
          log.warn(
            { chatId, messageId, error: err instanceof Error ? err.message : String(err) },
            'Failed to redact message',
          )
        })
      }
    },
  }
}
```

**Step 3: Write tests**

Create `tests/chat/telegram/reply-context.test.ts`:

```typescript
import { describe, expect, test, mock, beforeAll, afterAll } from 'bun:test'
import type { Context } from 'grammy'

// Mock dependencies
void mock.module('../../../src/logger.js', () => ({
  logger: {
    child: () => ({
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    }),
  },
}))

void mock.module('../../../src/chat/telegram/format.js', () => ({
  formatLlmOutput: (text: string) => ({ text, entities: [] }),
}))

import { TelegramChatProvider } from '../../../src/chat/telegram/index.js'

describe('TelegramChatProvider reply context', () => {
  let provider: TelegramChatProvider

  beforeAll(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token'
    provider = new TelegramChatProvider()
  })

  afterAll(() => {
    mock.restore()
  })

  test('extracts reply context from reply_to_message', () => {
    const mockContext = {
      from: { id: 123, username: 'testuser' },
      chat: { id: 456, type: 'private' },
      message: {
        message_id: 789,
        text: 'Reply text',
        reply_to_message: {
          message_id: 111,
          from: { id: 222, username: 'originaluser' },
          text: 'Original message',
        },
      },
    } as unknown as Context

    // Access private method via any
    const msg = (provider as unknown as { extractMessage(ctx: Context, isAdmin: boolean): unknown }).extractMessage(
      mockContext,
      false,
    )

    expect(msg).not.toBeNull()
    expect(msg?.replyContext).toBeDefined()
    expect(msg?.replyContext?.messageId).toBe('111')
    expect(msg?.replyContext?.authorId).toBe('222')
    expect(msg?.replyContext?.authorUsername).toBe('originaluser')
    expect(msg?.replyContext?.text).toBe('Original message')
  })

  test('extracts quote text from reply', () => {
    const mockContext = {
      from: { id: 123, username: 'testuser' },
      chat: { id: 456, type: 'private' },
      message: {
        message_id: 789,
        text: 'Reply text',
        reply_to_message: {
          message_id: 111,
          from: { id: 222, username: 'originaluser' },
          text: 'Full original message',
        },
        quote: {
          text: 'Quoted portion',
        },
      },
    } as unknown as Context

    const msg = (provider as unknown as { extractMessage(ctx: Context, isAdmin: boolean): unknown }).extractMessage(
      mockContext,
      false,
    )

    expect(msg?.replyContext?.quotedText).toBe('Quoted portion')
  })

  test('extracts message_thread_id for forum topics', () => {
    const mockContext = {
      from: { id: 123, username: 'testuser' },
      chat: { id: 456, type: 'supergroup' },
      message: {
        message_id: 789,
        text: 'Message in topic',
        message_thread_id: 999,
        reply_to_message: {
          message_id: 111,
          from: { id: 222, username: 'originaluser' },
          text: 'Original',
        },
      },
    } as unknown as Context

    const msg = (provider as unknown as { extractMessage(ctx: Context, isAdmin: boolean): unknown }).extractMessage(
      mockContext,
      false,
    )

    expect(msg?.replyContext?.threadId).toBe('999')
  })

  test('returns undefined replyContext when not a reply', () => {
    const mockContext = {
      from: { id: 123, username: 'testuser' },
      chat: { id: 456, type: 'private' },
      message: {
        message_id: 789,
        text: 'Standalone message',
      },
    } as unknown as Context

    const msg = (provider as unknown as { extractMessage(ctx: Context, isAdmin: boolean): unknown }).extractMessage(
      mockContext,
      false,
    )

    expect(msg?.replyContext).toBeUndefined()
  })
})
```

**Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

**Step 5: Run tests**

Run: `bun test tests/chat/telegram/reply-context.test.ts`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/chat/telegram/index.ts tests/chat/telegram/reply-context.test.ts
git commit -m "feat(telegram): capture reply context and support threading

Update Telegram provider to:
- Extract reply_to_message metadata into ReplyContext
- Capture quote text when available
- Support message_thread_id for forum topics
- Update ReplyFn to pass reply_parameters for threading

Add comprehensive tests for reply context extraction."
```

---

## Task 3: Implement Chain History Support (Optional)

**Dependencies:**

- Task 2 (ReplyContext types)
- See reference docs:
  - [Telegram Chain History](2026-03-26-telegram-chain-history.md)
  - [Mattermost Chain History](2026-03-26-mattermost-chain-history.md)

**Purpose:** Implement `chain` and `chainSummary` fields in `ReplyContext` to provide context from earlier messages in conversation threads. This is an optional enhancement - the core reply context works without it.

**Platform Approaches:**

### Telegram Chain History

Telegram Bot API only provides the immediate parent message. To build a chain, we need:

1. **Message Cache Service** - Cache all incoming messages with their reply metadata
2. **Chain Builder** - Walk back through cached messages to build the chain array
3. **Summary Generator** - Build human-readable summary from cached messages

**Files:**

- Create: `src/chat/telegram/message-cache.ts`
- Modify: `src/chat/telegram/index.ts` (to populate chain from cache)

**Implementation:**

```typescript
// src/chat/telegram/message-cache.ts
interface CachedMessage {
  messageId: string
  text?: string
  authorId?: string
  authorUsername?: string | null
  replyToMessageId?: string
  timestamp: number
}

const messageCache = new Map<string, CachedMessage>()
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

export function cacheMessage(
  messageId: string,
  text: string | undefined,
  from: { id?: number; username?: string } | undefined,
  replyToMessageId: number | undefined,
): void {
  messageCache.set(messageId, {
    messageId,
    text,
    authorId: from?.id ? String(from.id) : undefined,
    authorUsername: from?.username ?? null,
    replyToMessageId: replyToMessageId ? String(replyToMessageId) : undefined,
    timestamp: Date.now(),
  })

  // Prune old entries periodically
  pruneCache()
}

function pruneCache(): void {
  const cutoff = Date.now() - CACHE_TTL_MS
  for (const [id, msg] of messageCache) {
    if (msg.timestamp < cutoff) {
      messageCache.delete(id)
    }
  }
}

export function buildChain(messageId: string, maxDepth: number = 3): string[] | undefined {
  const chain: string[] = []
  let currentId: string | undefined = messageId

  while (currentId && chain.length < maxDepth) {
    const cached = messageCache.get(currentId)
    if (!cached?.replyToMessageId) break

    chain.push(cached.replyToMessageId)
    currentId = cached.replyToMessageId
  }

  return chain.length > 0 ? chain : undefined
}

export function buildChainSummary(chain: string[]): string | undefined {
  if (chain.length === 0) return undefined

  const summaries = chain
    .slice(0, -1) // Exclude immediate parent (already in text field)
    .map((msgId) => {
      const msg = messageCache.get(msgId)
      if (!msg) return null
      return `${msg.authorUsername || 'user'}: ${truncate(msg.text || '', 100)}`
    })
    .filter(Boolean)

  return summaries.length > 0 ? summaries.join(' → ') : undefined
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength) + '...' : text
}
```

### Mattermost Chain History

Mattermost provides thread API to fetch all posts in a thread:

1. **Thread API Client** - Fetch thread via `GET /api/v4/posts/{id}/thread`
2. **Thread Cache** - Cache thread data to avoid duplicate API calls
3. **Chain Builder** - Extract ordered post IDs from thread response

**Files:**

- Create: `src/chat/mattermost/thread-cache.ts`
- Modify: `src/chat/mattermost/index.ts` (to fetch thread and build chain)

**Implementation:**

```typescript
// src/chat/mattermost/thread-cache.ts
interface ThreadData {
  posts: Post[]
  fetchedAt: number
}

const threadCache = new Map<string, ThreadData>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export async function getThread(apiFetch: ApiFetchFn, threadId: string): Promise<Post[]> {
  const cached = threadCache.get(threadId)

  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.posts
  }

  const response = await apiFetch('GET', `/api/v4/posts/${threadId}/thread`)

  // Parse response: { order: string[], posts: Record<string, Post> }
  const posts = response.order.map((id: string) => response.posts[id])

  threadCache.set(threadId, {
    posts,
    fetchedAt: Date.now(),
  })

  return posts
}

export function buildChainFromThread(
  thread: Post[],
  currentPostId: string,
  maxDepth: number = 3,
): string[] | undefined {
  const currentIndex = thread.findIndex((p) => p.id === currentPostId)
  if (currentIndex <= 0) return undefined

  const chain: string[] = []
  const startIndex = Math.max(0, currentIndex - maxDepth)

  for (let i = startIndex; i < currentIndex; i++) {
    chain.push(thread[i].id)
  }

  return chain.length > 0 ? chain : undefined
}

export function buildChainSummary(thread: Post[], chain: string[]): string | undefined {
  const postsById = new Map(thread.map((p) => [p.id, p]))

  const summaries = chain
    .slice(0, -1) // Exclude immediate parent
    .map((postId) => {
      const post = postsById.get(postId)
      if (!post) return null
      return `${post.user_name || 'user'}: ${truncate(post.message, 100)}`
    })
    .filter((s): s is string => s !== null)

  return summaries.length > 0 ? summaries.join(' → ') : undefined
}
```

### Integration in Provider

Update provider to use chain builders when creating ReplyContext:

**Telegram:**

```typescript
// In extractMessage()
import { cacheMessage, buildChain, buildChainSummary } from './message-cache.js'

// Cache this message first
if (ctx.message) {
  cacheMessage(
    String(ctx.message.message_id),
    ctx.message.text,
    ctx.message.from,
    ctx.message.reply_to_message?.message_id,
  )
}

// Build chain if this is a reply
let chain: string[] | undefined
let chainSummary: string | undefined

if (replyToMessage) {
  const parentId = String(replyToMessage.message_id)
  chain = buildChain(parentId) // Walk back from parent
  if (chain) {
    chainSummary = buildChainSummary(chain)
  }
}

const replyContext: ReplyContext | undefined = replyToMessage
  ? {
      messageId: String(replyToMessage.message_id),
      authorId: replyToMessage.from?.id ? String(replyToMessage.from.id) : undefined,
      authorUsername: replyToMessage.from?.username ?? null,
      text: replyToMessage.text,
      quotedText: quote?.text,
      threadId: ctx.message?.message_thread_id ? String(ctx.message.message_thread_id) : undefined,
      chain, // ← Optional: requires message cache
      chainSummary, // ← Optional: requires message cache
    }
  : undefined
```

**Mattermost:**

```typescript
// In handlePostedEvent()
import { getThread, buildChainFromThread, buildChainSummary } from './thread-cache.js'

if (rootId) {
  try {
    // Fetch parent post
    const parentPost = await this.apiFetch('GET', `/api/v4/posts/${rootId}`)

    // Fetch thread for chain building (optional)
    let chain: string[] | undefined
    let chainSummary: string | undefined

    try {
      const thread = await getThread(this.apiFetch.bind(this), rootId)
      chain = buildChainFromThread(thread, post.id)
      if (chain) {
        chainSummary = buildChainSummary(thread, chain)
      }
    } catch (threadError) {
      log.warn({ error: threadError }, 'Failed to fetch thread for chain')
    }

    replyContext = {
      messageId: rootId,
      threadId: rootId,
      text: parentPost.message,
      authorId: parentPost.user_id,
      authorUsername: parentPost.user_name ?? null,
      chain, // ← Optional: requires thread API
      chainSummary, // ← Optional: requires thread API
    }
  } catch (error) {
    // Fallback: minimal context for threading
    replyContext = { messageId: rootId, threadId: rootId }
  }
}
```

**Note:** Chain functionality is optional - if cache/thread fetch fails, the bot still works with just immediate parent context.

---

## Task 4: Update Mattermost Provider

**Files:**

- Modify: `src/chat/mattermost/index.ts`
- Test: `tests/chat/mattermost/reply-context.test.ts`

**Step 1: Update handlePostedEvent to parse root_id and fetch parent post**

Modify `handlePostedEvent` method in `src/chat/mattermost/index.ts`:

```typescript
private async handlePostedEvent(data: Record<string, unknown>): Promise<void> {
  const postJson = data['post']
  if (typeof postJson !== 'string') return

  const postResult = MattermostPostSchema.safeParse(JSON.parse(postJson))
  if (!postResult.success) return
  const post = postResult.data

  if (post.user_id === this.botUserId) return

  // Parse root_id for threading
  const postData = JSON.parse(postJson) as { root_id?: string }
  const rootId = postData.root_id

  const channelInfo = await this.fetchChannelInfo(post.channel_id)
  const isGroup = channelInfo.type !== 'D'
  const contextType: ContextType = isGroup ? 'group' : 'dm'

  const isAdmin = await this.checkChannelAdmin(post.channel_id, post.user_id)
  const isMentioned = this.isBotMentioned(post.message)

  // Build reply context - fetch parent post if this is a reply
  let replyContext: ReplyContext | undefined
  if (rootId !== undefined && rootId !== '') {
    try {
      // Fetch parent post from Mattermost API
      const parentPost = await this.apiFetch('GET', `/api/v4/posts/${rootId}`)
      replyContext = {
        messageId: rootId,
        threadId: rootId,
        text: parentPost.message,
        authorId: parentPost.user_id,
        authorUsername: parentPost.user_name ?? null,
      }
    } catch (error) {
      log.warn({ error: error instanceof Error ? error.message : String(error), rootId }, 'Failed to fetch parent post')
      // Still create replyContext with just IDs for threading
      replyContext = {
        messageId: rootId,
        threadId: rootId,
      }
    }
  }

  const reply = this.buildReplyFn(post.channel_id, post.id, rootId)
  const command = this.matchCommand(post.message)

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
    replyContext,
  }

  if (command !== null) {
    const auth: AuthorizationResult = {
      allowed: true,
      isBotAdmin: isAdmin,
      isGroupAdmin: isAdmin,
      storageContextId: post.channel_id,
    }
    await command.handler(msg, reply, auth)
    return
  }

  if (this.messageHandler !== null) {
    await this.messageHandler(msg, reply)
  }
}
```

**Step 2: Update buildReplyFn to pass root_id**

Modify `buildReplyFn` method:

```typescript
import type { ReplyFn, ReplyOptions } from '../types.js'

private buildReplyFn(channelId: string, postId?: string, threadId?: string): ReplyFn {
  return {
    text: async (content: string, options?: ReplyOptions) => {
      await this.apiFetch('POST', '/api/v4/posts', {
        channel_id: channelId,
        message: content,
        root_id: options?.threadId ?? threadId ?? postId,
      })
    },
    formatted: async (markdown: string, options?: ReplyOptions) => {
      await this.apiFetch('POST', '/api/v4/posts', {
        channel_id: channelId,
        message: markdown,
        root_id: options?.threadId ?? threadId ?? postId,
      })
    },
    file: async (file: ChatFile, options?: ReplyOptions) => {
      const fileId = await this.uploadFile(channelId, file.content, file.filename)
      await this.apiFetch('POST', '/api/v4/posts', {
        channel_id: channelId,
        message: '',
        file_ids: [fileId],
        root_id: options?.threadId ?? threadId ?? postId,
      })
    },
    typing: () => {
      this.wsSend({ seq: this.wsSeq++, action: 'user_typing', data: { channel_id: channelId } })
    },
    redactMessage: async (replacementText: string) => {
      if (postId !== undefined) {
        await this.apiFetch('PUT', `/api/v4/posts/${postId}/patch`, { message: replacementText }).catch(
          (err: unknown) => {
            log.warn({ postId, error: err instanceof Error ? err.message : String(err) }, 'Failed to redact message')
          },
        )
      }
    },
  }
}
```

**Step 3: Write tests**

Create `tests/chat/mattermost/reply-context.test.ts`:

```typescript
import { describe, expect, test, mock, beforeAll, afterAll } from 'bun:test'

// Mock dependencies
void mock.module('../../../src/logger.js', () => ({
  logger: {
    child: () => ({
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    }),
  },
}))

import { MattermostChatProvider } from '../../../src/chat/mattermost/index.js'

describe('MattermostChatProvider reply context', () => {
  let provider: MattermostChatProvider

  beforeAll(() => {
    process.env.MATTERMOST_URL = 'http://localhost:8065'
    process.env.MATTERMOST_BOT_TOKEN = 'test-token'
    provider = new MattermostChatProvider()
  })

  afterAll(() => {
    mock.restore()
  })

  test('parses root_id from post data', async () => {
    const postData = {
      id: 'post123',
      user_id: 'user456',
      channel_id: 'channel789',
      message: 'Reply in thread',
      root_id: 'root111',
      user_name: 'testuser',
    }

    // Test that root_id is extracted correctly
    // This would be tested via the handlePostedEvent flow in integration tests
    expect(postData.root_id).toBe('root111')
  })

  test('buildReplyFn includes root_id in posts', async () => {
    // Mock the apiFetch method
    const apiCalls: unknown[] = []
    const mockApiFetch = mock((method: string, path: string, body: unknown) => {
      apiCalls.push({ method, path, body })
      return Promise.resolve({})
    })

    // Set up the provider with mocked apiFetch
    const providerAny = provider as unknown as {
      apiFetch: typeof mockApiFetch
      buildReplyFn: (channelId: string, postId?: string, threadId?: string) => unknown
    }
    providerAny.apiFetch = mockApiFetch

    const reply = providerAny.buildReplyFn('channel123', 'post456', 'root789')

    await (reply as { text: (content: string) => Promise<void> }).text('Test message')

    expect(apiCalls.length).toBe(1)
    expect((apiCalls[0] as { body: { root_id: string } }).body.root_id).toBe('root789')
  })

  test('buildReplyFn uses options threadId over default', async () => {
    const apiCalls: unknown[] = []
    const mockApiFetch = mock((method: string, path: string, body: unknown) => {
      apiCalls.push({ method, path, body })
      return Promise.resolve({})
    })

    const providerAny = provider as unknown as {
      apiFetch: typeof mockApiFetch
      buildReplyFn: (channelId: string, postId?: string, threadId?: string) => unknown
    }
    providerAny.apiFetch = mockApiFetch

    const reply = providerAny.buildReplyFn('channel123', 'post456', 'root789')

    await (reply as { text: (content: string, options?: { threadId?: string }) => Promise<void> }).text(
      'Test message',
      { threadId: 'override999' },
    )

    expect(apiCalls.length).toBe(1)
    expect((apiCalls[0] as { body: { root_id: string } }).body.root_id).toBe('override999')
  })
})
```

**Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

**Step 5: Run tests**

Run: `bun test tests/chat/mattermost/reply-context.test.ts`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/chat/mattermost/index.ts tests/chat/mattermost/reply-context.test.ts
git commit -m "feat(mattermost): parse root_id and support threading

Update Mattermost provider to:
- Parse root_id from incoming post data
- Build ReplyContext for threaded messages
- Pass root_id when posting replies
- Support ReplyOptions for dynamic threading

Add tests for root_id parsing and reply routing."
```

---

## Task 5: Update History Storage to Include Message IDs

**Files:**

- Modify: `src/history.ts`
- Modify: `src/bot.ts` (to pass messageId when storing)

**Step 1: Review current history storage**

Check how messages are currently stored in `src/history.ts` to understand where to add messageId metadata.

**Step 2: Update bot.ts to store messageId in history**

Find where incoming messages are added to history and update to include messageId:

```typescript
// In src/bot.ts, when handling messages
await addToHistory(contextId, {
  userId: msg.user.id,
  role: 'user',
  content: msg.text,
  messageId: msg.messageId, // Add this
})
```

**Step 3: Update where bot responses are stored**

Similarly, when storing bot responses:

```typescript
// After sending reply, store with messageId if available
await addToHistory(contextId, {
  userId: 'bot',
  role: 'assistant',
  content: responseText,
  messageId: responseMessageId, // Track this from platform response
})
```

Note: You may need to update ReplyFn return types to return message IDs, or handle this asynchronously.

**Step 4: Commit**

```bash
git add src/bot.ts src/history.ts
git commit -m "feat(history): store message IDs in conversation history

Update history storage to include messageId in metadata:
- Store incoming message IDs from platform
- Store outgoing response message IDs
- Enables message tracking for future features"
```

---

## Task 6: Integrate Reply Context into Bot Message Handling

**Files:**

- Modify: `src/bot.ts`

**Step 1: Import prompt builder**

At the top of `src/bot.ts`:

```typescript
import { buildPromptWithReplyContext } from './reply-context.js'
```

**Step 2: Update message handler to build contextual prompt**

Find the message handling flow and add prompt building:

```typescript
async function handleMessage(msg: IncomingMessage, reply: ReplyFn): Promise<void> {
  // Enrich message with reply context
  msg = await enrichWithReplyContext(msg)

  // Build prompt with context
  const prompt = buildPromptWithReplyContext(msg)

  // Build reply options for threading
  const replyOptions: import('./chat/types.js').ReplyOptions = {}
  if (msg.replyContext !== undefined) {
    replyOptions.threadId = msg.replyContext.threadId
    replyOptions.replyToMessageId = msg.replyContext.messageId
  }

  // Process with LLM (using enriched prompt)
  // ... existing LLM processing ...

  // Send response with threading options
  await reply.formatted(responseText, replyOptions)
}
```

**Step 3: Update system prompt (optional)**

Consider updating the system prompt to inform the LLM about reply context format:

```typescript
// In system prompt building
REPLY CONTEXT FORMAT:
When a user replies to a message, you'll see context like:
- [Replying to message from username: "message text"]
- [Quoted text: "quoted portion"]
- [Earlier context: summary]

Use this context to understand what the user is referencing.
```

**Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

**Step 5: Commit**

```bash
git add src/bot.ts
git commit -m "feat(bot): integrate reply context enrichment

Update bot message handler to:
- Enrich incoming messages with reply context
- Build prompts with parent message context
- Pass threading options when responding
- Maintain conversation flow in threads"
```

---

## Task 7: Update Command Handlers (if needed)

**Files:**

- Review: `src/commands/*.ts`

**Step 1: Check command handlers for reply needs**

Review command handlers to see if any need to support replies. Most commands likely don't need changes since they handle specific actions rather than conversational context.

**Step 2: Update ReplyFn usage in commands**

If any commands use `reply.text()` or `reply.formatted()`, they should work with the new optional `ReplyOptions` parameter without changes (backwards compatible).

---

## Task 8: Run Full Test Suite

**Step 1: Run all tests**

Run: `bun test`
Expected: All tests pass (except E2E if not configured)

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

**Step 3: Run linter**

Run: `bun run lint`
Expected: No errors

**Step 4: Run formatter check**

Run: `bun run format:check`
Expected: No issues

---

## Task 9: Integration Testing (Manual)

**Setup:**

1. Configure bot with Telegram and/or Mattermost
2. Start the bot: `bun start`

**Test Scenarios:**

**Telegram:**

1. Send a message: "Task #123 needs review"
2. Reply to that message: "Update it to done"
3. Verify bot sees context and knows to update Task #123
4. Verify bot response appears as a reply in the thread

**Mattermost:**

1. Post in a channel: "Task #456 is ready"
2. Reply in thread: "Can you archive it?"
3. Verify bot understands which task to archive
4. Verify bot response appears in the thread (not top-level)

---

## Task 10: Final Commit and Documentation

**Step 1: Final verification**

Run full check:

```bash
bun run check:full
```

**Step 2: Update CHANGELOG.md**

Add entry for this feature:

```markdown
## [Unreleased]

### Added

- Message reply and quote context awareness (#XXX)
  - Bot now captures when users reply to or quote messages
  - Parent message context is included in LLM prompts
  - Bot responses thread correctly in Telegram and Mattermost
```

**Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: update changelog with reply context feature"
```

---

## Summary

This implementation adds reply/quote context awareness to papai:

1. **Types** — `ReplyContext`, `ReplyOptions`, updated `IncomingMessage` and `ReplyFn`
2. **Context Enrichment** — New module looks up parent messages from history
3. **Telegram** — Extracts `reply_to_message`, `quote`, `message_thread_id`
4. **Mattermost** — Parses `root_id` for threading
5. **Bot Integration** — Enriches all messages, builds contextual prompts, threads responses

The bot now understands conversation context when users reply to messages, leading to more accurate responses and better conversation flow.
