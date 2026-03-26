# Mattermost Reply Chain Implementation

**Date:** 2026-03-26
**Status:** Design Document
**Approach:** Cache-Only (Option B)

## Overview

Implement reply chain tracking for Mattermost by integrating with the existing message-cache infrastructure. This approach caches messages as they arrive via WebSocket and builds reply chains from the cache, matching the Telegram implementation pattern.

## Design Decisions

### Why Cache-Only?

- **Simplicity:** Leverages existing, tested infrastructure
- **Performance:** No API calls required for chain building
- **Consistency:** Same behavior as Telegram provider
- **Trade-off:** Messages sent before bot startup won't be in cache

## Implementation Plan

### 1. Update MattermostPostSchema

Add `root_id` and `parent_id` fields to capture reply relationships:

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

**Location:** `src/chat/mattermost/index.ts:20-26`

### 2. Cache Incoming Messages

Import and use `cacheMessage()` in `handlePostedEvent()`:

```typescript
import { cacheMessage } from '../../message-cache/index.js'

// In handlePostedEvent() after post validation:
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

**Location:** `src/chat/mattermost/index.ts:139-165`

### 3. Populate replyToMessageId in IncomingMessage

Add the reply chain identifier to the message object:

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

**Location:** `src/chat/mattermost/index.ts:153-165`

## Data Flow

```
Mattermost WebSocket receives posted event
    ↓
Parse post JSON (including root_id, parent_id)
    ↓
Extract replyToMessageId = parent_id || root_id
    ↓
Cache message via cacheMessage()
    ↓
Create IncomingMessage with replyToMessageId
    ↓
Process message - chain builder can now trace replies
```

## Error Handling

- **Schema validation failure:** Silently skip message (existing behavior)
- **Cache write failure:** Log warning, continue processing (non-critical)
- **Missing parent_id/root_id:** Treat as standalone message (undefined replyToMessageId)

## Testing Strategy

1. **Unit tests:** Verify schema parsing with/without reply fields
2. **Integration tests:** Full flow with cached messages and chain building
3. **Mock WebSocket events:** Test various reply scenarios

## Files Modified

- `src/chat/mattermost/index.ts` - Schema update, caching, replyToMessageId population

## Files Reused (No Changes)

- `src/message-cache/cache.ts` - In-memory cache
- `src/message-cache/persistence.ts` - SQLite persistence
- `src/message-cache/chain.ts` - Chain builder
- `src/db/schema.ts` - messageMetadata table

## Success Criteria

- [ ] Mattermost posts with `parent_id`/`root_id` populate `replyToMessageId`
- [ ] Messages are cached and persisted to SQLite
- [ ] `buildReplyChain()` returns correct chain for Mattermost messages
- [ ] All existing Mattermost tests pass
- [ ] New tests cover reply chain scenarios

## References

- Telegram implementation: `docs/plans/2026-03-26-telegram-reply-chain-infrastructure.md`
- Mattermost API: `docs/plans/2026-03-26-mattermost-chain-history.md`
- Existing cache: `src/message-cache/`
