# Telegram Reply Chain History

**Date:** 2026-03-26
**Status:** Research Document

## Overview

This document describes how to retrieve the reply chain history from Telegram Bot API for building `chainSummary` in `ReplyContext`.

## Problem

Telegram Bot API provides only the **immediate parent** message in `reply_to_message`, but does not provide a chain of previous messages in the conversation thread. The `reply_to_message` field contains only one level of reply - you cannot traverse the full chain from the incoming message alone.

## What Telegram Bot API Provides

### In the Incoming Update

When a user replies to a message, the Bot API provides:

```typescript
ctx.message = {
  message_id: 789,
  text: "User's reply",
  reply_to_message: {
    // Only ONE level - immediate parent
    message_id: 111,
    from: { id: 222, username: 'originaluser' },
    text: 'Parent message content',
  },
}
```

**Key Limitation:**

- `reply_to_message` only contains the immediate parent
- The parent's `reply_to_message` field is NOT populated even if it was also a reply
- Bot cannot see the full conversation chain from the update alone

## Available Methods for Chain Retrieval

### Option 1: Use Local Bot API Server

Telegram Bot API server (when running locally) provides additional methods:

**Method:** `getChatHistory`

- Retrieves chat history with pagination
- Requires local Bot API server (not available on api.telegram.org)
- Bot must be admin to access full history

```typescript
// Requires local Bot API server
const history = await ctx.api.getChatHistory(chatId, {
  limit: 50,
  offset: 0,
})
```

**Limitations:**

- Not available on the public Bot API (api.telegram.org)
- Requires self-hosted Bot API server
- Bot must have been added to chat before messages were sent

### Option 2: Client-Side Cache

Maintain a local cache of messages seen by the bot:

```typescript
// Store message metadata as we receive them
interface CachedMessage {
  messageId: string
  text?: string
  authorId?: string
  authorUsername?: string
  replyToMessageId?: string
  timestamp: number
}

const messageCache = new Map<string, CachedMessage>()

// On each message, cache it
function cacheMessage(msg: Message): void {
  messageCache.set(String(msg.message_id), {
    messageId: String(msg.message_id),
    text: msg.text,
    authorId: msg.from?.id ? String(msg.from.id) : undefined,
    authorUsername: msg.from?.username ?? null,
    replyToMessageId: msg.reply_to_message?.message_id ? String(msg.reply_to_message.message_id) : undefined,
    timestamp: msg.date,
  })
}

// Build chain by walking backwards through cache
function buildChainFromCache(messageId: string, maxDepth: number = 5): string[] {
  const chain: string[] = []
  let currentId: string | undefined = messageId

  while (currentId && chain.length < maxDepth) {
    const cached = messageCache.get(currentId)
    if (!cached || !cached.replyToMessageId) break

    chain.push(cached.replyToMessageId)
    currentId = cached.replyToMessageId
  }

  return chain
}
```

**Advantages:**

- Works with public Bot API
- No additional API calls
- Fast lookups

**Limitations:**

- Only includes messages bot has actually seen
- Messages sent before bot joined are not cached
- Cache grows unbounded (needs pruning)

### Option 3: Hybrid Approach (Recommended)

Combine parent message from API with local cache:

```typescript
async function getReplyChain(ctx: Context, maxDepth: number = 3): Promise<ReplyContext['chain']> {
  const chain: string[] = []

  // Start with immediate parent from reply_to_message
  let currentId = ctx.message?.reply_to_message?.message_id

  while (currentId && chain.length < maxDepth) {
    chain.push(String(currentId))

    // Try to get this message's parent from cache
    const cached = messageCache.get(String(currentId))
    if (!cached?.replyToMessageId) break

    currentId = parseInt(cached.replyToMessageId, 10)
  }

  return chain.length > 0 ? chain : undefined
}
```

## Implementation Requirements

### Required Components

1. **Message Cache Service**
   - In-memory Map for fast lookups
   - TTL-based eviction (e.g., 24 hours)
   - Persistent storage for restarts (optional)

2. **Chain Builder**
   - Walk back through cached messages
   - Build array of message IDs
   - Limit depth to prevent context overflow

3. **Cache Integration**
   - Cache every incoming message
   - Extract and store reply metadata
   - Update on each message received

### Data Flow

```
User sends reply
    ↓
Bot receives update with reply_to_message
    ↓
Cache the current message (store reply_to_message_id)
    ↓
Build chain by walking back through cache
    ↓
Populate ReplyContext.chain
    ↓
Build chainSummary from cached messages
```

## Limitations

1. **Messages Before Bot Joined:** Cannot retrieve history from before bot was added to chat
2. **Bot Restarts:** Cache is lost unless persisted to database
3. **Deep Threads:** Long chains may exceed maxDepth limit
4. **Privacy Mode:** In private chats, bot only sees messages that mention it

## API Alternatives (Not Available to Bots)

### MTProto API

Full Telegram client API provides:

- `messages.getReplies` - Get all messages in a reply thread
- `messages.getHistory` - Get chat history

**Why Not Use:**

- Requires user authentication (not bot token)
- Different API surface than Bot API
- Much more complex to implement

## Recommendation

Use **Option 3 (Hybrid Approach)** with local message cache:

1. Cache all messages as they arrive
2. Extract `reply_to_message.message_id` from each
3. Build chain by walking back through cache
4. Limit chain depth to 3-5 messages
5. Store cache in memory with optional SQLite persistence

This provides reasonable chain coverage for active conversations while staying within Bot API limitations.

## Dependencies for Implementation

This feature depends on:

- Message caching infrastructure (new component)
- TTL-based cache eviction
- Integration with incoming message handler
- Storage of reply relationships

## References

- [Telegram Bot API - Message](https://core.telegram.org/bots/api#message)
- [Telegram Bot API - ReplyParameters](https://core.telegram.org/bots/api#replyparameters)
- [Local Bot API Server](https://core.telegram.org/bots/api#using-a-local-bot-api-server)
- [MTProto messages.getReplies](https://core.telegram.org/method/messages.getReplies)
