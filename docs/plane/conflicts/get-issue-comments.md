# Conflict: `get-issue-comments` — `created_by` UUID vs Display Name

**Severity**: Lower (cosmetic, but affects UX for bot output)  
**Date**: March 10, 2026  
**Status**: Research complete — recommendation provided

---

## 1. Problem Summary

Linear's comment API returns author information inline, including the user's display name:

```typescript
// Linear comment author
comment.user.displayName // → "Jane Smith"
```

Plane's `WorkItemComment` (which extends `BaseModel`) returns only a UUID:

```typescript
interface WorkItemComment extends BaseModel {
  // BaseModel provides:
  created_by: string // UUID e.g. "16c61a3a-512a-48ac-b0be-b6b46fe6f430"
  // No author name, no expand option
  comment_html?: string
  actor: string // same UUID as created_by
}
```

The gap is: papai's `get-issue-comments` tool returns comment data to an LLM, which presents it to a Telegram user. The display name is needed to convey authorship ("Alice wrote: ..."), but Plane gives only UUIDs.

---

## 2. API Verification

### Does `WorkItemComment` support an `expand` parameter?

**No.** The Plane REST API documents expand support only for `WorkItem` retrieve/list endpoints:

> Expandable Fields: `project`, `state`, `assignees`, `labels`, `module`, `type`

The `GET /api/v1/workspaces/{slug}/projects/{project_id}/work-items/{id}/comments/` endpoint has **no `expand` query parameter** documented. The raw API response for a comment is:

```json
{
  "id": "f3e29f26-708d-40f0-9209-7e0de44abc49",
  "created_by": "16c61a3a-512a-48ac-b0be-b6b46fe6f430",
  "updated_by": "16c61a3a-512a-48ac-b0be-b6b46fe6f430",
  "actor": "16c61a3a-512a-48ac-b0be-b6b46fe6f430",
  "comment_html": "<p>Initial thoughts...</p>",
  "access": "INTERNAL"
}
```

`created_by`, `updated_by`, and `actor` are all UUIDs — no embedded user object.

### Does the Plane Node SDK surface any richer comment type?

No. The SDK's `WorkItemComment` inherits from `BaseModel`:

```typescript
interface BaseModel {
  id: string
  created_at: Date
  updated_at: Date
  created_by: string // UUID only
  updated_by?: string // UUID only
}
```

The `client.workItems.comments.list()` call returns `PaginatedResponse<WorkItemComment>` with no expansion options in its method signature.

---

## 3. User Lookup Options

### 3a. Workspace Members API

**REST**: `GET /api/v1/workspaces/{workspace_slug}/members/`  
**SDK**: `client.workspace.getMembers(workspaceSlug)`  
**Scope required**: `workspaces.members:read`

Returns a flat list of all workspace members:

```json
[
  {
    "id": "16c61a3a-512a-48ac-b0be-b6b46fe6f430",
    "first_name": "Jane",
    "last_name": "Smith",
    "email": "jane@example.com",
    "display_name": "Jane Smith",
    "role": 15
  }
]
```

**Key finding**: This is a single request that returns **every member** with their `id`, `display_name`, and `email`. It is not paginated in documentation examples. All workspace members are co-located, making a one-shot batch resolution possible.

### 3b. Project Members API

**REST**: `GET /api/v1/workspaces/{slug}/projects/{project_id}/members/`  
**SDK**: `client.projects.getMembers(workspaceSlug, projectId)`  
**Scope required**: `projects.members:read`

Returns only members of a specific project — a subset of workspace members. Since comments can only be created by project members, this is sufficient for the comment authorship use case.

### 3c. `client.members` and `client.users` Namespaces

The SDK exposes both `client.members` and `client.users` but the analysis of `plane-node-sdk-analysis.md` does not document individual user-by-ID lookup methods. The workspace and project member list endpoints cover the resolution use case via `client.workspace.getMembers()` and `client.projects.getMembers()`.

There is **no documented single-user-by-ID endpoint** (`GET /users/{id}/`) in the current Plane API or SDK.

---

## 4. Performance Analysis

| Strategy                | API Calls per `getIssueComments` invocation  | Latency impact          | Notes                                |
| ----------------------- | -------------------------------------------- | ----------------------- | ------------------------------------ |
| No lookup — return UUID | 0 extra                                      | None                    | Minimal change, but poor UX          |
| N+1 per unique author   | 0–N (workspace members list per unique UUID) | Medium–High             | Gets worse with many comment authors |
| Batch workspace members | 1 extra (per invocation)                     | Low                     | One call fetches all author names    |
| In-session cache        | 0 after first call                           | Negligible after warmup | Best steady-state performance        |
| In-process module cache | 0 after first invocation ever                | Zero                    | Best overall, slight memory cost     |
| Return email            | 1 extra (workspace members)                  | Low                     | Slightly more privacy-invasive       |

### Workspace size context

A typical small-to-medium team workspace has 5–50 members. The workspace members list response is small (< 10 KB), and the API call is inexpensive. Caching it for the session lifetime is safe and practical.

---

## 5. Alternative Solutions

### Option A — Return UUID as-is (no lookup)

Simply pass `created_by` UUID through to the LLM prompt without resolution.

**Output**: `"User 16c61a3a wrote: ..."`

**Pros**:

- Zero extra API calls
- Zero complexity
- Avoids additional scope requirement (`workspaces.members:read`)

**Cons**:

- UUIDs are meaningless to humans and add noise to the LLM's context
- An LLM may hallucinate name from a UUID or express confusion
- Poor bot UX ("User 16c61a3a" is unreadable)

**Verdict**: Acceptable only as a fallback when workspace member data is unavailable.

---

### Option B — N+1 lookup per unique author

For each unique `created_by` UUID in the comment list, make a separate API call to look up the user. Since no single-user-by-ID endpoint is documented, this would instead call the project members list once per unique UUID and scan locally.

In practice this degenerates to Option C (batch lookup) but with extra list calls — **not recommended** as a distinct strategy.

---

### Option C — Batch lookup: fetch project members once per call

On each `getIssueComments` invocation, call `client.projects.getMembers(workspaceSlug, projectId)` once to get all project member profiles, then resolve all comment UUIDs in-memory.

```typescript
const members = await client.projects.getMembers(workspaceSlug, projectId)
const memberMap = new Map(members.map((m) => [m.id, m.display_name ?? m.email ?? m.id]))

const comments = response.results.map((c) => ({
  id: c.id,
  body: c.comment_html,
  createdAt: new Date(c.created_at),
  author: memberMap.get(c.created_by) ?? c.created_by,
}))
```

**Pros**:

- One extra API call total (not per comment)
- Always up-to-date on every invocation
- No cache invalidation concerns
- Simple to implement

**Cons**:

- One extra API call on every `getIssueComments` invocation (even when comments haven't changed)
- Requires `projects.members:read` scope

**Verdict**: Good baseline. Works without any caching infrastructure.

---

### Option D — In-session cache (recommended for papai)

Fetch workspace or project members once and cache the `Map<uuid, displayName>` for the duration of the conversation session (in-process, in-memory). The LLM session context already lives in `bot.ts` per user; member cache can live alongside it.

```typescript
type MemberCache = Map<string, string> // uuid → displayName
const memberCacheByWorkspace = new Map<string, MemberCache>()

async function resolveMemberName(client: PlaneClient, workspaceSlug: string, userId: string): Promise<string> {
  if (!memberCacheByWorkspace.has(workspaceSlug)) {
    const members = await client.workspace.getMembers(workspaceSlug)
    const cache: MemberCache = new Map(members.map((m) => [m.id ?? '', m.display_name ?? m.email ?? m.id ?? '']))
    memberCacheByWorkspace.set(workspaceSlug, cache)
  }
  return memberCacheByWorkspace.get(workspaceSlug)?.get(userId) ?? userId
}
```

**Pros**:

- 1 API call per workspace per session (amortized to ~0 per use)
- Fastest possible steady-state performance
- Works for any resource that references `created_by` UUIDs (future-proof)
- Workspace members list is stable during a session (people don't join/leave mid-conversation)

**Cons**:

- In-memory state — cleared on bot restart (acceptable; cache is cheap to rebuild)
- Requires `workspaces.members:read` scope (broader than project-scoped)
- Stale after workspace membership changes (acceptable for bot sessions lasting minutes)

**Verdict**: Best overall for papai. Low overhead, simple implementation.

---

### Option E — Return email as display name

Use `email` from the member lookup as the author identifier instead of `display_name`. Emails are human-readable and globally unique.

**Output**: `"jane.smith@company.com wrote: ..."`

**Pros**:

- Unambiguous identifier
- No display name collisions

**Cons**:

- Exposes email addresses in LLM context (privacy concern)
- Less friendly than first name or display name
- Still requires a member lookup (same cost as Option D)

**Verdict**: Acceptable fallback if `display_name` is absent, but not the primary choice.

---

### Option F — Omit author entirely

Strip `created_by` from the output. Comments are returned as a list without attribution.

**Output**: `["Initial thoughts: ...", "Agreed, let's proceed"]`

**Pros**:

- Zero extra API calls
- Simplest possible output

**Cons**:

- Loses important context — the LLM can't tell who agreed or who should follow up
- Defeats the purpose of `get-issue-comments` for collaboration awareness

**Verdict**: Not recommended. Authorship is meaningful in project management workflows.

---

## 6. Recommended Approach

**Option D — In-session workspace member cache** with `display_name`, falling back to `email`, then to the raw UUID.

**Rationale for papai's bot context**:

1. **Usage pattern**: `get-issue-comments` is called within an LLM session to answer questions like "who said what on issue ABC-123?". The LLM needs recognizable names to form a coherent answer.
2. **Session scope**: Bot sessions are short-lived (seconds to minutes per query). Member data fetched at session start is valid for the entire session.
3. **Cost**: One `workspace.getMembers` call per workspace per session is acceptable. Typical workspace has 5–50 members; the response is tiny.
4. **Scope**: `workspaces.members:read` is already likely needed for other features (assignee resolution, etc.).
5. **Graceful degradation**: Fall back to UUID if the member isn't found (e.g., deactivated user).

---

## 7. Implementation Sketch

```typescript
// src/plane/member-cache.ts

import type { PlaneClient } from '@makeplane/plane-node-sdk'

type MemberMap = ReadonlyMap<string, string>

// Module-level cache keyed by workspaceSlug
// Safe because the bot process is single-user-scoped per conversation
const cache = new Map<string, MemberMap>()

export async function getWorkspaceMemberName(
  client: PlaneClient,
  workspaceSlug: string,
  userId: string,
): Promise<string> {
  if (!cache.has(workspaceSlug)) {
    const members = await client.workspace.getMembers(workspaceSlug)
    const map = new Map(members.map((m) => [m.id ?? '', m.display_name ?? m.email ?? m.id ?? userId]))
    cache.set(workspaceSlug, map)
  }
  return cache.get(workspaceSlug)?.get(userId) ?? userId
}

export function clearMemberCache(workspaceSlug?: string): void {
  if (workspaceSlug !== undefined) {
    cache.delete(workspaceSlug)
  } else {
    cache.clear()
  }
}
```

```typescript
// src/plane/get-issue-comments.ts (updated mapping)

import type { PlaneClient } from '@makeplane/plane-node-sdk'
import { getWorkspaceMemberName } from './member-cache.js'

interface CommentResult {
  id: string
  body: string
  createdAt: Date
  author: string // display name or UUID fallback
}

export async function getIssueComments(
  client: PlaneClient,
  workspaceSlug: string,
  projectId: string,
  workItemId: string,
): Promise<CommentResult[]> {
  const response = await client.workItems.comments.list(workspaceSlug, projectId, workItemId, { limit: 100 })

  return Promise.all(
    response.results.map(async (c) => ({
      id: c.id,
      body: c.comment_html ?? c.comment_stripped ?? '',
      createdAt: new Date(c.created_at),
      author: await getWorkspaceMemberName(client, workspaceSlug, c.created_by),
    })),
  )
}
```

---

## 8. Cache Design

| Dimension        | Decision                                    | Rationale                                         |
| ---------------- | ------------------------------------------- | ------------------------------------------------- |
| **Scope**        | Module-level (process lifetime)             | Bot restarts clear state; no persistence needed   |
| **Key**          | `workspaceSlug`                             | Users may belong to multiple workspaces           |
| **Value**        | `Map<uuid, displayName>`                    | O(1) lookup per comment                           |
| **Source**       | `client.workspace.getMembers()`             | Returns all workspace members in one call         |
| **Warmup**       | Lazy (on first comment lookup)              | Avoids unnecessary load at startup                |
| **Invalidation** | None during session; process restart clears | Membership changes are rare within a conversation |
| **Fallback**     | UUID string                                 | Safe — LLM can still reason about it              |
| **Multi-user**   | Per-user bot instances are isolated         | No cross-user cache leakage                       |

### Cache lifecycle

```
First getIssueComments call for workspace "my-team"
  └─ cache miss → fetch workspace.getMembers("my-team") → populate Map
Second+ calls for "my-team"
  └─ cache hit → O(1) Map.get(uuid)
Bot restart / new conversation
  └─ module re-imported → cache empty → warm on next call
```

### Size estimate

50 members × ~100 bytes per entry = ~5 KB per workspace. Entirely negligible.

---

## 9. Summary of Findings

| Finding                         | Detail                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------- |
| No inline author expansion      | Comment endpoint has no `expand` parameter; `created_by` is always a UUID         |
| No single-user-by-ID endpoint   | Must use list-based resolution via workspace or project members API               |
| Workspace members API available | `GET /workspaces/{slug}/members/` returns all members with `display_name`         |
| SDK method confirmed            | `client.workspace.getMembers(workspaceSlug)` returns `User[]` with `display_name` |
| One call resolves all authors   | Batch resolution is O(1) API calls regardless of comment count                    |
| In-session cache is safe        | Membership is stable for session duration                                         |
| **Recommended**: Option D       | Single workspace members fetch, cached in-memory for session lifetime             |
