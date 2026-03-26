# Mattermost Reply Chain History

**Date:** 2026-03-26
**Status:** Research Document

## Overview

This document describes how to retrieve the reply chain history from Mattermost REST API for building `chainSummary` in `ReplyContext`.

## Problem

Mattermost WebSocket events provide the `root_id` of a thread, but do not include the full chain of previous messages. To build a `chainSummary`, we need to fetch the thread history and extract message IDs in order.

## What Mattermost WebSocket Provides

### In the Posted Event

When a user posts a reply, the WebSocket event provides:

```typescript
const postData = {
  id: 'post789',
  message: "User's reply",
  user_id: 'user123',
  channel_id: 'channel456',
  root_id: 'post111', // ← Root post of the thread
  parent_id: 'post111', // ← Same as root_id for replies
}
```

**Key Fields:**

- `root_id`: The root post ID of the thread
- `parent_id`: The direct parent post (same as root_id for simple replies)
- `id`: The current post's ID

**Limitation:** No chain of intermediate messages is provided in the event.

## Available Methods for Chain Retrieval

### Option 1: Fetch Thread via API

**Endpoint:** `GET /api/v4/posts/{post_id}/thread`

Returns all posts in a thread starting from the given post ID:

```typescript
async function getThreadPosts(threadId: string): Promise<Post[]> {
  const response = await fetch(
    `${MATTERMOST_URL}/api/v4/posts/${threadId}/thread`,
    {
      headers: {
        'Authorization': `Bearer ${botToken}`,
      },
    }
  )

  const data = await response.json()
  return data.order.map((postId: string) => data.posts[postId])
}

// Response structure:
{
  "order": ["post111", "post222", "post333", "post789"],  // Ordered list of post IDs
  "posts": {
    "post111": { id: "post111", message: "Root message", ... },
    "post222": { id: "post222", message: "Reply 1", parent_id: "post111", ... },
    "post333": { id: "post333", message: "Reply 2", parent_id: "post222", ... },
    "post789": { id: "post789", message: "Current reply", parent_id: "post333", ... },
  },
  "next_post_id": "",
  "prev_post_id": ""
}
```

**Advantages:**

- Returns complete thread history
- Posts are ordered chronologically
- Each post has `parent_id` for parent-child relationships

**Limitations:**

- Requires additional HTTP API call
- Returns entire thread (could be large)
- Bot must have read permission for the channel

### Option 2: Build Chain from Thread Data

```typescript
async function buildChainFromThread(threadId: string, currentPostId: string, maxDepth: number = 5): Promise<string[]> {
  const thread = await getThreadPosts(threadId)

  // Find current post in thread
  const currentIndex = thread.findIndex((p) => p.id === currentPostId)
  if (currentIndex === -1) return undefined

  // Build chain: all posts before current (up to maxDepth)
  const chain: string[] = []
  const startIndex = Math.max(0, currentIndex - maxDepth)

  for (let i = startIndex; i < currentIndex; i++) {
    chain.push(thread[i].id)
  }

  return chain.length > 0 ? chain : undefined
}

async function buildChainSummary(threadId: string, chain: string[]): Promise<string> {
  const thread = await getThreadPosts(threadId)
  const postsById = new Map(thread.map((p) => [p.id, p]))

  const summaries = chain
    .map((postId) => {
      const post = postsById.get(postId)
      if (!post) return null
      return `${post.user_name || 'user'}: ${truncate(post.message, 100)}`
    })
    .filter(Boolean)

  return summaries.join(' → ')
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength) + '...' : text
}
```

**Advantages:**

- Complete thread context
- Can limit to recent messages
- Uses platform-native threading

**Considerations:**

- Extra API call per reply message
- May need pagination for very long threads
- Should cache thread data to avoid duplicate calls

### Option 3: Client-Side Cache with Fallback

Combine API fetching with local caching:

```typescript
interface ThreadCache {
  posts: Post[]
  fetchedAt: number
  threadId: string
}

const threadCache = new Map<string, ThreadCache>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

async function getThreadWithCache(threadId: string): Promise<Post[]> {
  const cached = threadCache.get(threadId)

  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.posts
  }

  const posts = await getThreadPosts(threadId)
  threadCache.set(threadId, {
    posts,
    fetchedAt: Date.now(),
    threadId,
  })

  return posts
}

async function getReplyChain(threadId: string, currentPostId: string, maxDepth: number = 3): Promise<string[]> {
  const thread = await getThreadWithCache(threadId)

  const currentIndex = thread.findIndex((p) => p.id === currentPostId)
  if (currentIndex <= 0) return undefined

  // Get posts before current (excluding root for chainSummary)
  const chain: string[] = []
  const startIndex = Math.max(1, currentIndex - maxDepth)

  for (let i = startIndex; i < currentIndex; i++) {
    chain.push(thread[i].id)
  }

  return chain.length > 0 ? chain : undefined
}
```

**Advantages:**

- Reduces API calls for active threads
- Fresh data with reasonable TTL
- Handles concurrent messages in same thread

## Implementation Requirements

### Required Components

1. **Thread Cache Service**
   - In-memory cache with TTL
   - Thread ID to posts mapping
   - Automatic eviction

2. **Thread API Client**
   - `GET /api/v4/posts/{post_id}/thread`
   - Error handling (404, 403)
   - Pagination support (for very long threads)

3. **Chain Builder**
   - Parse thread response
   - Extract ordered post IDs
   - Build chain array
   - Generate summary strings

4. **Integration Point**
   - Called in `handlePostedEvent` when `root_id` is present
   - After fetching parent post
   - Before creating `ReplyContext`

### Data Flow

```
WebSocket receives posted event with root_id
    ↓
Fetch parent post via GET /api/v4/posts/{root_id}
    ↓
Fetch thread via GET /api/v4/posts/{root_id}/thread
    ↓
Build chain from thread posts (up to maxDepth)
    ↓
Generate chainSummary from earlier posts
    ↓
Populate ReplyContext with chain and chainSummary
    ↓
Process message with full context
```

## API Pagination

For very long threads, the API supports pagination:

```typescript
// Paginated thread fetch
async function* paginateThread(threadId: string, perPage: number = 50): AsyncGenerator<Post[]> {
  let page = 0
  let hasMore = true

  while (hasMore) {
    const response = await fetch(`${MATTERMOST_URL}/api/v4/posts/${threadId}/thread?page=${page}&per_page=${perPage}`, {
      headers: { Authorization: `Bearer ${botToken}` },
    })

    const data = await response.json()
    const posts = data.order.map((id: string) => data.posts[id])

    yield posts

    hasMore = posts.length === perPage
    page++
  }
}
```

**Recommendation:** For chain building, fetch only first page (50 posts) which is sufficient for most reply chains.

## Limitations

1. **Deleted Posts:** Thread API may return 404 if root post was deleted
2. **Permissions:** Bot must have read access to the channel
3. **API Rate Limits:** Thread fetches count against API limits
4. **Large Threads:** Very active threads may require multiple API calls

## Error Handling

```typescript
async function safeBuildChain(
  threadId: string,
  currentPostId: string,
): Promise<{ chain?: string[]; chainSummary?: string }> {
  try {
    const thread = await getThreadWithCache(threadId)
    const chain = buildChain(thread, currentPostId)
    const summary = buildSummary(thread, chain)
    return { chain, chainSummary: summary }
  } catch (error) {
    // Log but don't fail - thread context is optional
    logger.warn({ error, threadId }, 'Failed to build chain')
    return {}
  }
}
```

## Dependencies for Implementation

This feature depends on:

- Thread API client (`GET /api/v4/posts/{id}/thread`)
- Thread cache with TTL
- Error handling for missing/invalid threads
- Integration with `handlePostedEvent`

## References

- [Mattermost API - Get a thread](https://api.mattermost.com/#tag/posts/paths/~1posts~1{post_id}~1thread/get)
- [Mattermost API - Get a post](https://api.mattermost.com/#tag/posts/paths/~1posts~1{post_id}/get)
- [Mattermost WebSocket Events](https://api.mattermost.com/#tag/WebSocket)
