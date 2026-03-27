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

**Note on `chain` and `chainSummary`:**

These fields provide context from earlier messages in a conversation thread. Neither platform natively provides a complete chain of message IDs in the incoming event:

- **Telegram**: Bot API only provides immediate parent via `reply_to_message`. Full chain requires building from local message cache (see: [Telegram Chain History](2026-03-26-telegram-chain-history.md))
- **Mattermost**: WebSocket provides `root_id` only. Full chain requires fetching thread via `GET /api/v4/posts/{id}/thread` (see: [Mattermost Chain History](2026-03-26-mattermost-chain-history.md))

Both platforms require **additional implementation work** to support chain functionality.

````

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
````

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

### 3. Platform-Specific Context Extraction

**Telegram** — Full parent message included in update:

Telegram Bot API provides the complete parent message in the `reply_to_message` field of incoming updates. No additional API calls or history lookups are needed.

```typescript
private extractMessage(ctx: Context, isAdmin: boolean): IncomingMessage | null {
  // ... existing extraction ...

  const replyToMessage = ctx.message?.reply_to_message
  const quote = ctx.message?.quote

  // Full parent message text is already available!
  const replyContext: ReplyContext | undefined = replyToMessage ? {
    messageId: String(replyToMessage.message_id),
    authorId: replyToMessage.from?.id ? String(replyToMessage.from.id) : undefined,
    authorUsername: replyToMessage.from?.username ?? null,
    text: replyToMessage.text,  // ← Full text from reply_to_message
    quotedText: quote?.text,
    threadId: ctx.message?.message_thread_id ? String(ctx.message.message_thread_id) : undefined,
  } : undefined

  return {
    // ... existing fields ...
    replyContext,  // Already complete, no enrichment needed
  }
}
```

**Mattermost** — Fetch parent post via API:

Mattermost only provides `root_id` in the incoming event. We must fetch the parent post via REST API.

```typescript
private async handlePostedEvent(data: Record<string, unknown>): Promise<void> {
  // ... existing code ...

  const post = postResult.data
  const postData = JSON.parse(postJson) as { root_id?: string }
  const rootId = postData.root_id

  let replyContext: ReplyContext | undefined

  if (rootId) {
    // Fetch parent post from Mattermost API
    const parentPost = await this.apiFetch('GET', `/api/v4/posts/${rootId}`)

    replyContext = {
      messageId: rootId,
      threadId: rootId,
      text: parentPost.message,        // ← Fetched from API
      authorId: parentPost.user_id,
      authorUsername: parentPost.user_name ?? null,
    }
  }

  const msg: IncomingMessage = {
    // ... existing fields ...
    replyContext,  // Complete after API fetch
  }
}
```

**Key Difference:**

| Platform   | Parent Text Source                       | Requires API Call? |
| ---------- | ---------------------------------------- | ------------------ |
| Telegram   | Included in `reply_to_message`           | No                 |
| Mattermost | Must fetch via `/api/v4/posts/{post_id}` | Yes                |

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

## Workflow

```mermaid
flowchart TD
    subgraph Entry["Entry Points"]
        T[Telegram Message Received]
        M[Mattermost Message Received]
    end

    subgraph Extract["Provider Extraction"]
        T --> T1{Has reply_to_message?}
        T1 -->|Yes| T2[Extract messageId<br/>authorId<br/>authorUsername<br/>text]
        T1 -->|No| T3[replyContext = undefined]
        T2 --> T4{Has quote?}
        T4 -->|Yes| T5[Extract quotedText]
        T4 -->|No| T6[Skip quote]
        T5 --> T7{Has message_thread_id?}
        T6 --> T7
        T7 -->|Yes| T8[Extract threadId]
        T7 -->|No| T9[Skip thread]
        T8 --> T10[Build ReplyContext]
        T9 --> T10

        M --> M1{Has root_id?}
        M1 -->|Yes| M2[Extract messageId<br/>threadId = root_id]
        M1 -->|No| M3[replyContext = undefined]
        M2 --> M4[Build ReplyContext]
    end

    subgraph Build["Build Prompt"]
        T10 --> P1{replyContext exists?}
        M4 --> P1
        M3 --> P11[Use original text]
        P1 -->|No| P11
        P1 -->|Yes| P2[buildPromptWithReplyContext]
        P2 --> P3{Has text?}
        P3 -->|Yes| P4[Add: [Replying to<br/>message from<br/>author: "text"]]
        P3 -->|No| P5
        P4 --> P5{Has quotedText?}
        P5 -->|Yes| P6[Add: [Quoted text:<br/>"quotedText"]]
        P5 -->|No| P7
        P6 --> P7{Has chainSummary?}
        P7 -->|Yes| P8[Add: [Earlier<br/>context:<br/>summary]]
        P7 -->|No| P9
        P8 --> P10[Join context +<br/>original message]
        P9 --> P10
    end

    subgraph Response["Response Handling"]
        P10 --> R1[Process with LLM]
        P11 --> R1
        R1 --> R2[Generate response]
        R2 --> R3{replyContext exists?}
        R3 -->|Yes| R4[Build ReplyOptions:<br/>- threadId<br/>- replyToMessageId]
        R3 -->|No| R5[Empty ReplyOptions]
        R4 --> R6[Send via reply.formatted<br/>with options]
        R5 --> R6
    end

    subgraph Platform["Platform-Specific Response"]
        R6 --> R7{Platform?}
        R7 -->|Telegram| R8[Use reply_parameters<br/>with message_id]
        R7 -->|Mattermost| R9[Use root_id in<br/>POST /api/v4/posts]
    end

    R8 --> END[Message sent<br/>in correct thread]
    R9 --> END

    style Entry fill:#e1f5e1
    style Extract fill:#e3f2fd
    style Build fill:#fff3e0
    style Prompt fill:#fce4ec
    style Response fill:#f3e5f5
    style Platform fill:#e8f5e9
```

### Entry Points (2)

- **Telegram** — Message received via Grammy context
- **Mattermost** — Message received via WebSocket event

### Key Conditions (6)

1. `Has reply_to_message?` / `Has root_id?` — determines if context extraction occurs
2. `Has quote?` — captures quoted text (Telegram only)
3. `Has message_thread_id?` — captures forum topic/thread ID
4. `replyContext exists?` — includes context in prompt or skips
5. `Has chain?` — builds multi-message chain summaries
6. `Platform?` — routes to Telegram or Mattermost response logic

### Outcomes (4)

1. **Standalone message** — No context, plain prompt, no threading
2. **Reply with context** — Parent message text included in prompt
3. **Reply with quote** — Quoted portion highlighted in prompt
4. **Threaded conversation** — Bot responds in same thread using platform APIs

### Data Flow

```
Raw Message → Extract Reply Metadata → Build Contextual Prompt → LLM → Threaded Response
```

**Platform Differences:**

- **Telegram**: Full parent message included in `reply_to_message` field
- **Mattermost**: Must fetch parent post via `GET /api/v4/posts/{post_id}`

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
