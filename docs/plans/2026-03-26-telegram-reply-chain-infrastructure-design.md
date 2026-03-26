# Telegram Reply Chain Infrastructure Design

**Date:** 2026-03-26
**Status:** Design Approved
**Scope:** Infrastructure code for Message Reply & Quote Context feature

## Overview

This document describes the infrastructure implementation for tracking Telegram reply chains. The feature provides the foundation for building `chainSummary` in `ReplyContext` by caching message metadata and enabling traversal of reply chains.

This is **infrastructure only** - it provides the caching layer and chain building utilities that the Message Reply & Quote Context feature will use.

## Problem

Telegram Bot API provides only the **immediate parent** message in `reply_to_message`, but does not provide the full chain of previous messages in the conversation thread. Building context-aware replies requires retrieving the entire reply chain.

## Solution

Use a **hybrid approach** combining:
1. **Local message metadata cache** with 1-week TTL
2. **Background persistence** to SQLite
3. **Chain builder** that walks back through cached messages

## Architecture

### Components

1. **Message Metadata Cache Service** (`src/message-cache/`)
   - In-memory: Map for fast lookups
   - TTL: 1 week eviction
   - Persistent: SQLite table `message_metadata`
   - Background sync: Reuses existing `queueMicrotask` pattern from `cache-db.ts`

2. **Reply Chain Builder** (`src/message-cache/chain.ts`)
   - Function: `buildReplyChain(messageId: string): Promise<string[]>`
   - Walks back through cached messages via `replyToMessageId`
   - No depth limit (relies on TTL + cycle detection)
   - Returns array of message IDs in chronological order (oldest → newest)

3. **Provider Integration** (Telegram only for this task)
   - Extract `reply_to_message.message_id` in `extractMessage()`
   - Cache message metadata on every incoming message
   - Add `replyToMessageId?: string` to `IncomingMessage` type

### Database Schema

```typescript
// src/db/schema.ts
export const messageMetadata = sqliteTable('message_metadata', {
  messageId: text('message_id').primaryKey(),
  contextId: text('context_id').notNull(), // chat ID
  authorId: text('author_id'),
  authorUsername: text('author_username'),
  text: text('text'), // Full message text, not truncated
  replyToMessageId: text('reply_to_message_id'),
  timestamp: integer('timestamp').notNull(),
  expiresAt: integer('expires_at').notNull(), // 1 week from timestamp
})
```

### Types

```typescript
// src/message-cache/types.ts
interface CachedMessage {
  messageId: string
  contextId: string
  authorId?: string
  authorUsername?: string
  text?: string
  replyToMessageId?: string
  timestamp: number
}

// Augment IncomingMessage in src/chat/types.ts
interface IncomingMessage {
  // ... existing fields
  replyToMessageId?: string
}
```

### Cache API

```typescript
// src/message-cache/index.ts

// Cache a message (called from provider)
export function cacheMessage(msg: CachedMessage): void

// Build reply chain for a message ID
export function buildReplyChain(messageId: string): Promise<string[]>

// Get cached message by ID (for building summary later)
export function getCachedMessage(messageId: string): CachedMessage | undefined
```

## Data Flow

### Message Reception Flow

```
Incoming Telegram Message
        ↓
extractMessage() in telegram/index.ts
        ↓
Extract: message_id, text, author, reply_to_message.message_id
        ↓
cacheMessage({
  messageId: "123",
  contextId: chatId,
  authorId: userId,
  authorUsername: username,
  text: fullMessageText,
  replyToMessageId: parentMessageId,
  timestamp: Date.now()
})
        ↓
Store in memory cache + background sync to SQLite
        ↓
Return IncomingMessage with replyToMessageId
```

### Chain Building Flow

```
User replies to message 789
        ↓
Bot receives message with reply_to_message.message_id = 789
        ↓
Cache message 789's metadata
        ↓
buildReplyChain("789"):
  - Look up 789 in cache
  - Found: replyToMessageId = "456"
  - Look up 456 in cache  
  - Found: replyToMessageId = "123"
  - Look up 123 in cache
  - Found: no replyToMessageId (root message)
  - Return: ["123", "456", "789"] (oldest → newest)
```

## Error Handling

### Scenarios

1. **Message not in cache** (expired or never seen)
   - **Behavior**: Chain building stops at the gap
   - **Result**: Returns partial chain up to the gap
   - **Logged**: `warn` level with message ID

2. **Circular references** (message A → B → A)
   - **Behavior**: Track visited message IDs during chain walk
   - **Result**: Stop if cycle detected, return chain up to cycle point
   - **Logged**: `error` level with cycle details

3. **Database write failures**
   - **Behavior**: Cache remains in memory, retry on next operation
   - **Result**: Non-critical, messages survive in memory cache
   - **Logged**: `error` level, continues operation

4. **Memory pressure**
   - **Behavior**: TTL eviction (1 week) prevents unbounded growth
   - **Result**: Old messages automatically removed
   - **Logged**: `debug` level

### Safety Mechanisms

- **Cycle detection**: Set of visited IDs during traversal
- **Graceful degradation**: Return partial chain if any step fails
- **Non-blocking**: Cache operations don't delay message processing
- **No depth limit**: TTL and cycle detection provide sufficient safety

## Testing Strategy

### Unit Tests

1. **Message Cache Tests** (`tests/message-cache/`)
   - `cacheMessage()` stores and retrieves messages
   - TTL eviction removes expired messages
   - Database persistence on background sync
   - Duplicate message handling (upsert)

2. **Chain Builder Tests**
   - Linear chain: A → B → C → D
   - Branched replies (different chains from same parent)
   - Missing parent in cache (chain stops at gap)
   - Circular reference detection
   - Empty chain (no replies)

3. **Provider Integration Tests**
   - Telegram extracts `reply_to_message.message_id`
   - Message metadata passed through correctly
   - Edge cases: forwarded messages, media messages

### E2E Tests

- Full flow: Send reply → Verify cached → Build chain
- Bot restart persistence: Cache survives restart via SQLite
- Concurrent message handling: No race conditions in cache

## Provider Scope

This implementation focuses on **Telegram provider** (`src/chat/telegram/`). However, the message cache infrastructure is **provider-agnostic** and can be extended to Mattermost and other platforms later.

## Integration Points

- **Telegram Provider** (`src/chat/telegram/index.ts:106-130`):
  - Extract `reply_to_message?.message_id`
  - Call `cacheMessage()` for every message
  - Add `replyToMessageId` to returned `IncomingMessage`

- **Database** (`src/db/schema.ts`):
  - Add `messageMetadata` table
  - Run migrations

## Files to Create/Modify

### New Files
- `src/message-cache/types.ts` - Type definitions
- `src/message-cache/index.ts` - Cache API
- `src/message-cache/chain.ts` - Chain builder
- `src/message-cache/cache-db.ts` - Background persistence (if separate from main cache-db)
- `tests/message-cache/` - Test directory

### Modified Files
- `src/db/schema.ts` - Add messageMetadata table
- `src/db/migrations/` - New migration file
- `src/chat/types.ts` - Add replyToMessageId to IncomingMessage
- `src/chat/telegram/index.ts` - Extract and cache reply metadata

## References

- Original research: `/docs/plans/2026-03-26-telegram-chain-history.md`
- Existing cache implementation: `src/cache.ts`, `src/cache-db.ts`
- Telegram Bot API docs: https://core.telegram.org/bots/api#message
