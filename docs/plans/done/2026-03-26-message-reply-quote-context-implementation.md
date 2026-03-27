# Message Reply & Quote Context Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable the bot to capture reply/quote context from user messages, include parent message context in prompts, and respond in the correct thread.

**Architecture:** Build `ReplyContext` objects in platform providers using existing message-cache infrastructure (cache, chain builder, persistence). Create a prompt builder module that formats reply context for LLM consumption. Update `ReplyFn` to support threading via `ReplyOptions`.

**Tech Stack:** TypeScript, Grammy (Telegram), Mattermost REST API, SQLite (message cache)

**Prerequisites (already implemented):**

- `src/message-cache/` — In-memory cache with SQLite persistence, `cacheMessage()`, `getCachedMessage()`, `buildReplyChain()`, 1-week TTL
- `IncomingMessage.replyToMessageId` — Both providers already extract and populate this field
- Both Telegram and Mattermost providers call `cacheMessage()` on every incoming message
- Mattermost schema includes `root_id` and `parent_id` fields

---

## Task 1: Update Type Definitions

**Files:**

- Modify: `src/chat/types.ts`

**Step 1: Add ReplyContext type**

Add after the `ChatFile` type:

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
  /** Full reply chain message IDs in chronological order (oldest first) */
  chain?: string[]
  /** Summary of earlier messages in the chain (excludes immediate parent) */
  chainSummary?: string
}
```

**Step 2: Add replyContext to IncomingMessage**

Keep existing `replyToMessageId` (used by message-cache infrastructure). Add `replyContext`:

```typescript
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
  /** parent message ID if this is a reply */
  replyToMessageId?: string
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
export type ReplyFn = {
  text: (content: string, options?: ReplyOptions) => Promise<void>
  formatted: (markdown: string, options?: ReplyOptions) => Promise<void>
  file: (file: ChatFile, options?: ReplyOptions) => Promise<void>
  typing: () => void
  redactMessage?: (replacementText: string) => Promise<void>
}
```

**Step 5: Verify typecheck passes**

Run: `bun typecheck`

Expected: No errors (ReplyOptions is optional, so all existing callers are compatible)

**Step 6: Commit**

```bash
git add src/chat/types.ts
git commit -m "feat(types): add ReplyContext and ReplyOptions types

- ReplyContext with messageId, author info, text, quotedText, threadId, chain, chainSummary
- ReplyOptions for controlling response threading
- Update ReplyFn to accept optional ReplyOptions
- Keep existing replyToMessageId for message-cache compatibility"
```

---

## Task 2: Create Reply Context Prompt Builder Module

**Files:**

- Create: `src/reply-context.ts`
- Test: `tests/reply-context.test.ts`

**Note:** This module uses the existing `getCachedMessage()` and `buildReplyChain()` from `src/message-cache/` — no history lookup needed.

**Step 1: Create the module file**

Create `src/reply-context.ts`:

```typescript
import type { IncomingMessage, ReplyContext } from './chat/types.js'
import { logger } from './logger.js'
import { buildReplyChain, getCachedMessage } from './message-cache/index.js'

const log = logger.child({ scope: 'reply-context' })

/**
 * Builds chain and summary from cached messages for a reply.
 * Uses the shared message-cache infrastructure (in-memory + SQLite).
 */
export function buildReplyContextChain(
  contextId: string,
  replyToMessageId: string,
): { chain?: string[]; chainSummary?: string } {
  const result = buildReplyChain(contextId, replyToMessageId)

  if (result.chain.length <= 1) {
    return {}
  }

  // Build summary from earlier messages (exclude the last = immediate parent, already shown in replyContext.text)
  const earlierMessages = result.chain.slice(0, -1)
  const summaries: string[] = []

  for (const msgId of earlierMessages) {
    const msg = getCachedMessage(contextId, msgId)
    if (msg === undefined) continue
    const author = msg.authorUsername ?? 'user'
    const text = truncate(msg.text ?? '', 100)
    summaries.push(`${author}: ${text}`)
  }

  return {
    chain: result.chain,
    chainSummary: summaries.length > 0 ? summaries.join(' → ') : undefined,
  }
}

/**
 * Builds a prompt string with reply context prepended.
 *
 * ReplyContext is already fully populated by platform providers:
 * - Telegram: reply_to_message fields + message cache chain
 * - Mattermost: cached parent or API fetch + message cache chain
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

**Step 2: Write tests**

Create `tests/reply-context.test.ts`:

```typescript
import { describe, expect, test, beforeEach, afterAll, mock } from 'bun:test'
import type { IncomingMessage } from '../src/chat/types.js'
import { mockLogger, setupTestDb, mockDrizzle } from './utils/test-helpers.js'

mockLogger()

const testDb = setupTestDb()
mockDrizzle(testDb.db)

afterAll(() => {
  mock.restore()
})

import { buildPromptWithReplyContext, buildReplyContextChain } from '../src/reply-context.js'
import { cacheMessage, clearMessageCache } from '../src/message-cache/index.js'

function makeDmMessage(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    user: { id: 'user1', username: 'testuser', isAdmin: false },
    contextId: 'ctx1',
    contextType: 'dm',
    isMentioned: false,
    text: 'Hello world',
    ...overrides,
  }
}

describe('buildPromptWithReplyContext', () => {
  test('returns plain text when no reply context', () => {
    const msg = makeDmMessage({ text: 'Hello world' })
    expect(buildPromptWithReplyContext(msg)).toBe('Hello world')
  })

  test('includes parent message context', () => {
    const msg = makeDmMessage({
      text: 'Can you update it?',
      replyContext: {
        messageId: 'msg123',
        authorUsername: 'otheruser',
        text: 'Task #123 needs review',
      },
    })

    const result = buildPromptWithReplyContext(msg)

    expect(result).toContain('[Replying to message from otheruser:')
    expect(result).toContain('Task #123 needs review')
    expect(result).toContain('Can you update it?')
  })

  test('includes quoted text', () => {
    const msg = makeDmMessage({
      text: 'This part is important',
      replyContext: {
        messageId: 'msg123',
        quotedText: 'Important detail here',
      },
    })

    const result = buildPromptWithReplyContext(msg)

    expect(result).toContain('[Quoted text: "Important detail here"]')
  })

  test('includes chain summary', () => {
    const msg = makeDmMessage({
      text: 'Follow-up question',
      replyContext: {
        messageId: 'msg3',
        authorUsername: 'bob',
        text: 'Second message',
        chainSummary: 'alice: First message',
      },
    })

    const result = buildPromptWithReplyContext(msg)

    expect(result).toContain('[Earlier context: alice: First message]')
    expect(result).toContain('[Replying to message from bob:')
    expect(result).toContain('Follow-up question')
  })

  test('truncates long parent messages', () => {
    const longText = 'a'.repeat(300)
    const msg = makeDmMessage({
      text: 'Short question',
      replyContext: {
        messageId: 'msg123',
        authorUsername: 'user',
        text: longText,
      },
    })

    const result = buildPromptWithReplyContext(msg)

    expect(result).toContain('...')
    expect(result.length).toBeLessThan(longText.length + 100)
  })

  test('falls back to "user" when authorUsername is missing', () => {
    const msg = makeDmMessage({
      text: 'Reply',
      replyContext: {
        messageId: 'msg123',
        text: 'Original',
      },
    })

    const result = buildPromptWithReplyContext(msg)

    expect(result).toContain('[Replying to message from user:')
  })
})

describe('buildReplyContextChain', () => {
  beforeEach(() => {
    clearMessageCache()
  })

  test('returns empty when chain has only one message', () => {
    cacheMessage({
      messageId: 'A',
      contextId: 'ctx1',
      text: 'Root message',
      timestamp: Date.now(),
    })

    const result = buildReplyContextChain('ctx1', 'A')

    expect(result.chain).toBeUndefined()
    expect(result.chainSummary).toBeUndefined()
  })

  test('builds chain summary for multi-message chain', () => {
    cacheMessage({ messageId: 'A', contextId: 'ctx1', authorUsername: 'alice', text: 'First', timestamp: Date.now() })
    cacheMessage({
      messageId: 'B',
      contextId: 'ctx1',
      authorUsername: 'bob',
      text: 'Second',
      replyToMessageId: 'A',
      timestamp: Date.now(),
    })
    cacheMessage({
      messageId: 'C',
      contextId: 'ctx1',
      authorUsername: 'alice',
      text: 'Third',
      replyToMessageId: 'B',
      timestamp: Date.now(),
    })

    // Build chain from C (the parent being replied to)
    const result = buildReplyContextChain('ctx1', 'C')

    expect(result.chain).toEqual(['A', 'B', 'C'])
    // Summary excludes C (the immediate parent) — only earlier messages
    expect(result.chainSummary).toContain('alice: First')
    expect(result.chainSummary).toContain('bob: Second')
  })

  test('returns undefined chainSummary when earlier messages not cached', () => {
    // Only the parent is cached, earlier messages expired/missing
    cacheMessage({
      messageId: 'C',
      contextId: 'ctx1',
      text: 'Third',
      replyToMessageId: 'B',
      timestamp: Date.now(),
    })

    const result = buildReplyContextChain('ctx1', 'C')

    // Chain is broken at B
    expect(result.chain).toBeUndefined()
    expect(result.chainSummary).toBeUndefined()
  })
})
```

**Step 3: Run tests**

Run: `bun test tests/reply-context.test.ts`

Expected: All tests pass

**Step 4: Commit**

```bash
git add src/reply-context.ts tests/reply-context.test.ts
git commit -m "feat: add reply context prompt builder module

- buildReplyContextChain() builds chain and summary from message cache
- buildPromptWithReplyContext() formats context for LLM prompt
- Uses existing message-cache infrastructure (no history lookup needed)"
```

---

## Task 3: Update Telegram Provider

**Files:**

- Modify: `src/chat/telegram/index.ts`
- Test: `tests/chat/telegram/reply-context.test.ts`

**Step 1: Update extractMessage to build ReplyContext**

Modify `extractMessage` method (lines 107-151) in `src/chat/telegram/index.ts`. The method already caches messages and extracts `replyToMessageId`. Add ReplyContext building:

```typescript
import { buildReplyContextChain } from '../../reply-context.js'
import type { ..., ReplyContext } from '../types.js'

private extractMessage(ctx: Context, isAdmin: boolean): IncomingMessage | null {
  const id = ctx.from?.id
  if (id === undefined) return null

  const chatType = ctx.chat?.type
  const isGroup = chatType === 'group' || chatType === 'supergroup' || chatType === 'channel'
  const contextId = String(ctx.chat?.id ?? id)
  const contextType: ContextType = isGroup ? 'group' : 'dm'

  const text = ctx.message?.text ?? ''
  const isMentioned = this.isBotMentioned(text, ctx.message?.entities)

  const messageId = ctx.message?.message_id
  const messageIdStr = messageId === undefined ? undefined : String(messageId)

  const replyToMessage = ctx.message?.reply_to_message
  const replyToMessageId = replyToMessage?.message_id
  const replyToMessageIdStr = replyToMessageId === undefined ? undefined : String(replyToMessageId)

  // Cache message metadata for reply chain tracking
  if (messageIdStr !== undefined) {
    cacheMessage({
      messageId: messageIdStr,
      contextId,
      authorId: String(id),
      authorUsername: ctx.from?.username ?? undefined,
      text,
      replyToMessageId: replyToMessageIdStr,
      timestamp: Date.now(),
    })
  }

  // Build reply context if this is a reply
  let replyContext: ReplyContext | undefined
  if (replyToMessage !== undefined && replyToMessageIdStr !== undefined) {
    const quote = ctx.message?.quote
    const { chain, chainSummary } = buildReplyContextChain(contextId, replyToMessageIdStr)

    replyContext = {
      messageId: replyToMessageIdStr,
      authorId: replyToMessage.from?.id !== undefined ? String(replyToMessage.from.id) : undefined,
      authorUsername: replyToMessage.from?.username ?? null,
      text: replyToMessage.text,
      quotedText: quote?.text,
      threadId: ctx.message?.message_thread_id !== undefined
        ? String(ctx.message.message_thread_id)
        : undefined,
      chain,
      chainSummary,
    }
  }

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
    messageId: messageIdStr,
    replyToMessageId: replyToMessageIdStr,
    replyContext,
  }
}
```

**Step 2: Update buildReplyFn to support threading**

Modify `buildReplyFn` method (lines 183-212) to pass `reply_parameters`:

```typescript
import type { ..., ReplyOptions } from '../types.js'

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
      await ctx.reply(content, { reply_parameters: replyParams })
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
    file: async (file, options?: ReplyOptions) => {
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
import { describe, expect, test } from 'bun:test'
import type { ReplyContext } from '../../../src/chat/types.js'

describe('Telegram reply context extraction logic', () => {
  test('builds ReplyContext from reply_to_message', () => {
    // Simulate what extractMessage does
    const replyToMessage = {
      message_id: 111,
      from: { id: 222, username: 'originaluser' },
      text: 'Original message',
    }
    const quote = undefined

    const replyContext: ReplyContext = {
      messageId: String(replyToMessage.message_id),
      authorId: String(replyToMessage.from.id),
      authorUsername: replyToMessage.from.username ?? null,
      text: replyToMessage.text,
      quotedText: quote?.text,
    }

    expect(replyContext.messageId).toBe('111')
    expect(replyContext.authorId).toBe('222')
    expect(replyContext.authorUsername).toBe('originaluser')
    expect(replyContext.text).toBe('Original message')
    expect(replyContext.quotedText).toBeUndefined()
  })

  test('extracts quote text from reply', () => {
    const replyToMessage = {
      message_id: 111,
      from: { id: 222, username: 'originaluser' },
      text: 'Full original message',
    }
    const quote = { text: 'Quoted portion' }

    const replyContext: ReplyContext = {
      messageId: String(replyToMessage.message_id),
      authorId: String(replyToMessage.from.id),
      authorUsername: replyToMessage.from.username ?? null,
      text: replyToMessage.text,
      quotedText: quote.text,
    }

    expect(replyContext.quotedText).toBe('Quoted portion')
  })

  test('extracts message_thread_id for forum topics', () => {
    const messageThreadId = 999
    const replyToMessage = {
      message_id: 111,
      from: { id: 222, username: 'user' },
      text: 'Original',
    }

    const replyContext: ReplyContext = {
      messageId: String(replyToMessage.message_id),
      threadId: String(messageThreadId),
      text: replyToMessage.text,
    }

    expect(replyContext.threadId).toBe('999')
  })

  test('returns undefined replyContext when not a reply', () => {
    const replyToMessage = undefined
    const replyContext = replyToMessage !== undefined ? { messageId: 'irrelevant' } : undefined

    expect(replyContext).toBeUndefined()
  })
})
```

**Step 4: Run typecheck and tests**

```bash
bun typecheck
bun test tests/chat/telegram/reply-context.test.ts
```

Expected: All pass

**Step 5: Commit**

```bash
git add src/chat/telegram/index.ts tests/chat/telegram/reply-context.test.ts
git commit -m "feat(telegram): build ReplyContext and support threading

- Extract reply_to_message metadata into ReplyContext
- Capture quote text when available
- Build chain/chainSummary from message cache
- Support message_thread_id for forum topics
- Update buildReplyFn with reply_parameters for threading"
```

---

## Task 4: Update Mattermost Provider

**Files:**

- Modify: `src/chat/mattermost/index.ts`
- Test: `tests/chat/mattermost/reply-context.test.ts` (update existing)

**Step 1: Update handlePostedEvent to build ReplyContext**

Modify `handlePostedEvent` method (lines 142-189). Message caching is already done. Add ReplyContext building after the cache call:

```typescript
import { cacheMessage, getCachedMessage } from '../../message-cache/index.js'
import { buildReplyContextChain } from '../../reply-context.js'
import type { ..., ReplyContext, ReplyOptions } from '../types.js'

private async handlePostedEvent(data: Record<string, unknown>): Promise<void> {
  const postJson = data['post']
  if (typeof postJson !== 'string') return
  const postResult = MattermostPostSchema.safeParse(JSON.parse(postJson))
  if (!postResult.success) return
  const post = postResult.data
  if (post.user_id === this.botUserId) return

  const replyToMessageId = extractReplyId(post.parent_id, post.root_id)
  cacheMessage({
    messageId: post.id,
    contextId: post.channel_id,
    authorId: post.user_id,
    authorUsername: post.user_name,
    text: post.message,
    replyToMessageId,
    timestamp: Date.now(),
  })

  // Build reply context if this is a reply
  let replyContext: ReplyContext | undefined
  if (replyToMessageId !== undefined) {
    const threadId = post.root_id !== undefined && post.root_id !== '' ? post.root_id : replyToMessageId
    const { chain, chainSummary } = buildReplyContextChain(post.channel_id, replyToMessageId)

    // Try to get parent message from cache first
    const parentMsg = getCachedMessage(post.channel_id, replyToMessageId)
    if (parentMsg !== undefined) {
      replyContext = {
        messageId: replyToMessageId,
        threadId,
        text: parentMsg.text,
        authorId: parentMsg.authorId,
        authorUsername: parentMsg.authorUsername ?? null,
        chain,
        chainSummary,
      }
    } else {
      // Parent not in cache — fetch via API
      try {
        const parentPost = await this.apiFetch('GET', `/api/v4/posts/${replyToMessageId}`, undefined)
        const parsed = MattermostPostSchema.safeParse(parentPost)
        if (parsed.success) {
          replyContext = {
            messageId: replyToMessageId,
            threadId,
            text: parsed.data.message,
            authorId: parsed.data.user_id,
            authorUsername: parsed.data.user_name ?? null,
            chain,
            chainSummary,
          }
        } else {
          replyContext = { messageId: replyToMessageId, threadId }
        }
      } catch (error) {
        log.warn(
          { error: error instanceof Error ? error.message : String(error), replyToMessageId },
          'Failed to fetch parent post for reply context',
        )
        replyContext = { messageId: replyToMessageId, threadId }
      }
    }
  }

  const channelInfo = await this.fetchChannelInfo(post.channel_id)
  const contextType: ContextType = channelInfo.type === 'D' ? 'dm' : 'group'
  const isAdmin = await this.checkChannelAdmin(post.channel_id, post.user_id)
  const rootId = post.root_id !== undefined && post.root_id !== '' ? post.root_id : undefined
  const reply = this.buildReplyFn(post.channel_id, post.id, rootId)
  const command = this.matchCommand(post.message)
  const msg: IncomingMessage = {
    user: { id: post.user_id, username: post.user_name ?? null, isAdmin },
    contextId: post.channel_id,
    contextType,
    isMentioned: this.isBotMentioned(post.message),
    text: post.message,
    commandMatch: command?.match,
    messageId: post.id,
    replyToMessageId,
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

**Step 2: Update buildReplyFn to support threading via root_id**

Update `buildReplyFn` signature to accept `threadId` and pass `root_id` in posts:

```typescript
private buildReplyFn(channelId: string, postId?: string, threadId?: string): ReplyFn {
  return {
    text: async (content: string, options?: ReplyOptions) => {
      await this.apiFetch('POST', '/api/v4/posts', {
        channel_id: channelId,
        message: content,
        root_id: options?.threadId ?? threadId ?? '',
      })
    },
    formatted: async (markdown: string, options?: ReplyOptions) => {
      await this.apiFetch('POST', '/api/v4/posts', {
        channel_id: channelId,
        message: markdown,
        root_id: options?.threadId ?? threadId ?? '',
      })
    },
    file: async (file, options?: ReplyOptions) => {
      const fileId = await this.uploadFile(channelId, file.content, file.filename)
      await this.apiFetch('POST', '/api/v4/posts', {
        channel_id: channelId,
        message: '',
        file_ids: [fileId],
        root_id: options?.threadId ?? threadId ?? '',
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

**Step 3: Update tests**

Update `tests/chat/mattermost/reply-chain.test.ts` to include ReplyContext extraction tests:

```typescript
// Add to existing test file

describe('Mattermost Reply Context', () => {
  test('should build ReplyContext from cached parent', () => {
    const post = {
      id: 'reply123',
      user_id: 'user456',
      channel_id: 'channel789',
      message: 'Reply message',
      parent_id: 'parent456',
      root_id: 'root789',
    }

    const replyToMessageId = extractReplyId(post.parent_id, post.root_id)
    const threadId = post.root_id !== '' ? post.root_id : replyToMessageId

    expect(replyToMessageId).toBe('parent456')
    expect(threadId).toBe('root789')
  })

  test('should use root_id as threadId when available', () => {
    const post = { root_id: 'root123', parent_id: '' }
    const replyToMessageId = extractReplyId(post.parent_id, post.root_id)
    const threadId = post.root_id !== '' ? post.root_id : replyToMessageId

    expect(threadId).toBe('root123')
  })

  test('should fall back to replyToMessageId as threadId', () => {
    const post = { root_id: '', parent_id: 'parent456' }
    const replyToMessageId = extractReplyId(post.parent_id, post.root_id)
    const threadId = post.root_id !== '' ? post.root_id : replyToMessageId

    expect(threadId).toBe('parent456')
  })
})
```

**Step 4: Run typecheck and tests**

```bash
bun typecheck
bun test tests/chat/mattermost/
```

Expected: All pass

**Step 5: Commit**

```bash
git add src/chat/mattermost/index.ts tests/chat/mattermost/reply-chain.test.ts
git commit -m "feat(mattermost): build ReplyContext and support threading

- Build ReplyContext from cached parent or API fallback
- Build chain/chainSummary from message cache
- Pass root_id in buildReplyFn for threading
- Graceful fallback when parent post unavailable"
```

---

## Task 5: Integrate Reply Context into Bot Message Handler

**Files:**

- Modify: `src/bot.ts`

**Step 1: Import prompt builder**

Add at the top of `src/bot.ts`:

```typescript
import { buildPromptWithReplyContext } from './reply-context.js'
```

**Step 2: Use enriched prompt in message handler**

Update the `chat.onMessage` handler (lines 101-128) to use `buildPromptWithReplyContext`:

```typescript
chat.onMessage(async (msg, reply) => {
  const auth = checkAuthorizationExtended(
    msg.user.id,
    msg.user.username,
    msg.contextId,
    msg.contextType,
    msg.user.isAdmin,
  )

  if (!auth.allowed) {
    if (msg.isMentioned) {
      await reply.text(
        "You're not authorized to use this bot in this group. Ask a group admin to add you with `/group adduser @{username}`",
      )
    }
    return
  }

  const hasCommand = msg.commandMatch !== undefined && msg.commandMatch !== ''
  const isNaturalLanguage = !hasCommand
  if (msg.contextType === 'group' && isNaturalLanguage && !msg.isMentioned) {
    return
  }

  reply.typing()
  const prompt = buildPromptWithReplyContext(msg)
  await processMessage(reply, auth.storageContextId, msg.user.username, prompt)
})
```

**Step 3: Run typecheck**

Run: `bun typecheck`

Expected: No errors

**Step 4: Commit**

```bash
git add src/bot.ts
git commit -m "feat(bot): use reply context in LLM prompts

- Build enriched prompt with parent message context
- Pass enriched text to processMessage instead of raw msg.text
- Bot now understands what message the user is replying to"
```

---

## Task 6: Run Full Test Suite

**Step 1: Run all tests**

Run: `bun test`

Expected: All tests pass

**Step 2: Run full check**

Run: `bun check:full`

Expected: All checks pass (lint, typecheck, format, knip, tests)

**Step 3: Fix any issues found**

If knip reports unused exports in `src/message-cache/`, remove `@public` annotations from:

- `src/message-cache/cache.ts` — `hasCachedMessage`, `clearMessageCache`
- `src/message-cache/chain.ts` — `buildReplyChain`
- `src/message-cache/persistence.ts` — `startMessageCleanupScheduler`

These functions are now used by `src/reply-context.ts` and the providers, so `@public` annotations should no longer be needed. Verify by running `bun knip` after removal.

**Step 4: Commit**

```bash
git add .
git commit -m "chore: fix lint/knip/format issues from reply context integration"
```

---

## Task 7: Final Verification and CHANGELOG

**Step 1: Final verification**

Run: `bun check:full`

Expected: All checks pass

**Step 2: Update CHANGELOG.md**

Add entry for this feature:

```markdown
## [Unreleased]

### Added

- Message reply and quote context awareness
  - Bot captures when users reply to or quote messages
  - Parent message context included in LLM prompts
  - Reply chain summaries for multi-level threads
  - Bot responses thread correctly in Telegram and Mattermost
```

**Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: update changelog with reply context feature"
```

---

## Summary

### Files Created

- `src/reply-context.ts` — Prompt builder with chain summary helper
- `tests/reply-context.test.ts` — Unit tests for prompt builder
- `tests/chat/telegram/reply-context.test.ts` — Telegram reply context tests

### Files Modified

- `src/chat/types.ts` — Add `ReplyContext`, `ReplyOptions`; update `ReplyFn`
- `src/chat/telegram/index.ts` — Build `ReplyContext` in `extractMessage`, threading in `buildReplyFn`
- `src/chat/mattermost/index.ts` — Build `ReplyContext` in `handlePostedEvent`, threading in `buildReplyFn`
- `src/bot.ts` — Use `buildPromptWithReplyContext()` before calling `processMessage`
- `tests/chat/mattermost/reply-chain.test.ts` — Add ReplyContext extraction tests
- `src/message-cache/*.ts` — Remove `@public` knip annotations (now used directly)

### Key Design Decisions

1. **Keep `replyToMessageId` AND `replyContext`** — `replyToMessageId` is used by message-cache for chain building; `replyContext` is the rich object for LLM prompts. Different consumers, different needs.
2. **No `enrichWithReplyContext()` function** — Providers build complete `ReplyContext` objects directly. Telegram gets parent data from Grammy context; Mattermost uses cache with API fallback.
3. **Reuse existing message-cache** — `buildReplyChain()` and `getCachedMessage()` provide chain data. No duplicate cache modules in providers.
4. **`ReplyOptions` is optional** — Backwards compatible. Providers auto-thread based on incoming message context; `ReplyOptions` allows overriding.
5. **Chain summary excludes immediate parent** — Parent text is shown in `[Replying to...]` section; chain summary only shows earlier messages to avoid duplication.
