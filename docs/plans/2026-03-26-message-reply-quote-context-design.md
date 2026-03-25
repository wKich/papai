# Message Reply & Quote Context

**Date:** 2026-03-26
**Status:** Approved

## Problem

When a user replies to or quotes a previous message, the AI agent currently receives only the plain text of the reply, losing critical context about what the user is referencing. This leads to:

1. **Ambiguous queries** — "Can you update it?" requires the agent to guess what "it" refers to
2. **Broken conversation flow** — The agent responds as a new top-level message instead of continuing the thread
3. **Missing context** — The agent cannot see the quoted text or the message being replied to

**Example:** User says "Update the status to done" while replying to a message about "Task #123". Without reply context, the agent doesn't know which task to update.

## Design

### Approach: Provider-Level Reply Extraction

Extend platform providers to capture reply metadata, enrich messages with historical context, and support thread-aware responses.

### 1. Data Model Changes

**New type: `ReplyContext`**

```typescript
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
  /** Platform-specific thread/topic ID */
  threadId?: string
  /** Full reply chain - parent message IDs in order */
  chain?: string[]
  /** Summary of earlier messages in the chain */
  chainSummary?: string
}
```

**Update `IncomingMessage`:**

```typescript
export type IncomingMessage = {
  user: ChatUser
  contextId: string
  contextType: ContextType
  isMentioned: boolean
  text: string
  commandMatch?: string
  messageId?: string
  replyContext?: ReplyContext // NEW
}
```

**Update `ReplyFn` and add `ReplyOptions`:**

```typescript
export type ReplyOptions = {
  /** Reply to this specific message ID */
  replyToMessageId?: string
  /** Post in this thread/topic */
  threadId?: string
}

export type ReplyFn = {
  text: (content: string, options?: ReplyOptions) => Promise<void>
  formatted: (markdown: string, options?: ReplyOptions) => Promise<void>
  file: (file: ChatFile, options?: ReplyOptions) => Promise<void>
  typing: () => void
  redactMessage?: (replacementText: string) => Promise<void>
}
```

### 2. Provider Implementation

**Telegram Provider (`src/chat/telegram/index.ts`):**

Capture `reply_to_message` and `quote` fields from Grammy context:

```typescript
private extractMessage(ctx: Context, isAdmin: boolean): IncomingMessage | null {
  // ... existing extraction ...

  const replyToMessage = ctx.message?.reply_to_message
  const quote = ctx.message?.quote

  const replyContext: ReplyContext | undefined = replyToMessage ? {
    messageId: String(replyToMessage.message_id),
    authorId: replyToMessage.from?.id ? String(replyToMessage.from.id) : undefined,
    authorUsername: replyToMessage.from?.username ?? null,
    text: replyToMessage.text,
    quotedText: quote?.text,
    threadId: ctx.message?.message_thread_id ? String(ctx.message.message_thread_id) : undefined,
  } : undefined

  return {
    // ... existing fields ...
    replyContext,
  }
}
```

Update `buildReplyFn()` to support `reply_parameters`:

```typescript
private buildReplyFn(ctx: Context): ReplyFn {
  const chatId = ctx.chat?.id
  const messageId = ctx.message?.message_id

  return {
    text: async (content: string, options?: ReplyOptions) => {
      await ctx.reply(content, {
        reply_parameters: options?.replyToMessageId
          ? { message_id: parseInt(options.replyToMessageId, 10) }
          : messageId ? { message_id: messageId } : undefined
      })
    },
    // ... similar for formatted, file ...
  }
}
```

**Mattermost Provider (`src/chat/mattermost/index.ts`):**

Parse `root_id` from posts for threading:

```typescript
private async handlePostedEvent(data: Record<string, unknown>): Promise<void> {
  // ... existing code ...

  const post = postResult.data
  const postData = JSON.parse(postJson) as { root_id?: string }

  const replyContext: ReplyContext | undefined = postData.root_id ? {
    messageId: postData.root_id,
    threadId: postData.root_id,
  } : undefined

  const msg: IncomingMessage = {
    // ... existing fields ...
    replyContext,
  }
}
```

Update `buildReplyFn()` to pass `root_id`:

```typescript
private buildReplyFn(channelId: string, postId?: string, threadId?: string): ReplyFn {
  return {
    text: async (content: string, options?: ReplyOptions) => {
      await this.apiFetch('POST', '/api/v4/posts', {
        channel_id: channelId,
        message: content,
        root_id: options?.threadId ?? threadId ?? postId,
      })
    },
    // ... similar for formatted, file ...
  }
}
```

### 3. Context Enrichment Module

**New module: `src/reply-context.ts`**

```typescript
import type { IncomingMessage, ReplyContext } from './chat/types.js'
import { getHistory } from './history.js'

export async function enrichWithReplyContext(msg: IncomingMessage): Promise<IncomingMessage> {
  if (!msg.replyContext) return msg

  // Look up parent message from history
  const parentMessage = await lookupMessageFromHistory(msg.contextId, msg.replyContext.messageId)

  if (parentMessage) {
    msg.replyContext.text = parentMessage.text
    msg.replyContext.authorId = parentMessage.userId
  }

  // Build reply chain summary
  if (msg.replyContext.chain && msg.replyContext.chain.length > 0) {
    msg.replyContext.chainSummary = await buildChainSummary(msg.contextId, msg.replyContext.chain)
  }

  return msg
}

async function lookupMessageFromHistory(
  contextId: string,
  messageId: string,
): Promise<{ text: string; userId: string } | null> {
  const history = await getHistory(contextId)
  const entry = history.find((h) => h.metadata?.messageId === messageId)
  return entry ? { text: entry.content, userId: entry.userId } : null
}

async function buildChainSummary(contextId: string, chain: string[]): Promise<string> {
  const history = await getHistory(contextId)
  const messages = chain.map((id) => history.find((h) => h.metadata?.messageId === id)).filter(Boolean)

  if (messages.length === 0) return ''

  // Summarize earlier messages in chain (not the immediate parent)
  return messages
    .slice(0, -1)
    .map((m) => `${m.userId}: ${truncate(m.content, 100)}`)
    .join(' → ')
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength) + '...' : text
}
```

### 4. Bot-Level Integration

**Update `src/bot.ts`:**

```typescript
import { enrichWithReplyContext } from './reply-context.js'

async function handleMessage(msg: IncomingMessage, reply: ReplyFn): Promise<void> {
  // Enrich with reply context
  msg = await enrichWithReplyContext(msg)

  // Build prompt with context
  const prompt = buildPromptWithReplyContext(msg)

  // Build reply options for threading
  const replyOptions: ReplyOptions = {}
  if (msg.replyContext) {
    replyOptions.threadId = msg.replyContext.threadId
    replyOptions.replyToMessageId = msg.replyContext.messageId
  }

  // Process with LLM and respond
  const response = await processWithLlm(prompt)
  await reply.formatted(response, replyOptions)
}

function buildPromptWithReplyContext(msg: IncomingMessage): string {
  let prompt = msg.text

  if (msg.replyContext) {
    const context: string[] = []

    if (msg.replyContext.text) {
      context.push(
        `[Replying to message from ${msg.replyContext.authorUsername || 'user'}: "${truncate(msg.replyContext.text, 200)}"]`,
      )
    }

    if (msg.replyContext.quotedText) {
      context.push(`[Quoted text: "${msg.replyContext.quotedText}"]`)
    }

    if (msg.replyContext.chainSummary) {
      context.push(`[Earlier context: ${msg.replyContext.chainSummary}]`)
    }

    prompt = context.join('\n') + '\n\n' + prompt
  }

  return prompt
}
```

### 5. History Storage Update

**Update conversation history to store message IDs:**

```typescript
// In src/history.ts or conversation tracking
export async function addToHistory(contextId: string, entry: HistoryEntry & { messageId?: string }): Promise<void> {
  await saveHistoryEntry(contextId, {
    ...entry,
    metadata: {
      ...entry.metadata,
      messageId: entry.messageId,
    },
  })
}
```

## Files Changed

| File                           | Change                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------- |
| `src/chat/types.ts`            | Add `ReplyContext` type, update `IncomingMessage`, add `ReplyOptions`           |
| `src/chat/telegram/index.ts`   | Extract `reply_to_message` and `quote`, support `reply_parameters` in responses |
| `src/chat/mattermost/index.ts` | Parse `root_id`, pass to POST /api/v4/posts                                     |
| `src/reply-context.ts`         | New module for context enrichment                                               |
| `src/bot.ts`                   | Integrate enrichment, build prompts with context, use reply options             |
| `src/history.ts`               | Store messageId in metadata for lookup                                          |

## Behavior

### Context Detection

- All replies provide context, regardless of who sent the original message
- Works for replies to bot messages, user messages, or any message in the conversation

### Reply Chain Depth

- Immediate parent: Full text retrieved from history
- Earlier messages in chain: Summarized (author + truncated content)
- Limited to prevent context overflow

### Thread-Aware Responses

- Bot always replies in the same thread as the user's message
- Uses platform-native threading (Telegram: reply_parameters, Mattermost: root_id)
- Creates consistent conversation flow

## Platform Differences

| Feature        | Telegram                      | Mattermost                    |
| -------------- | ----------------------------- | ----------------------------- |
| Reply metadata | `reply_to_message` object     | `root_id` field               |
| Quote support  | `quote.text` field            | N/A (quotes are just replies) |
| Forum topics   | `message_thread_id`           | N/A                           |
| Threading API  | `reply_parameters.message_id` | `root_id` in POST body        |

## Testing

- Unit test: Telegram provider extracts reply context correctly
- Unit test: Mattermost provider parses root_id correctly
- Unit test: `enrichWithReplyContext` looks up messages from history
- Unit test: `buildPromptWithReplyContext` formats context correctly
- Unit test: Bot passes reply options when responding
- E2E test: Reply in Telegram thread, verify bot responds in same thread
- E2E test: Reply in Mattermost thread, verify bot responds in same thread
- E2E test: Verify context is included in LLM prompt

## Alternatives Considered

- **Middleware-based injection** — Rejected: modifies message text, harder to control formatting, loses structured metadata needed for threading
- **Persistent reply graph** — Rejected: overkill for current needs, significant schema changes, more complex than necessary

## Future Enhancements

- Configurable context depth (how many messages to include)
- Smart context filtering (exclude very old messages)
- Cross-platform message ID mapping for multi-platform bots
- Visual thread navigation in chat UIs
