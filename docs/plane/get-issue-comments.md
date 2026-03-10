# Mapping: `getIssueComments` → Plane SDK

## Linear Implementation

**File**: `src/linear/get-issue-comments.ts`

```typescript
getIssueComments({ apiKey, issueId }):
  Promise<{ id: string; body: string; createdAt: Date }[]>
```

**Linear SDK call**:
```typescript
const client = new LinearClient({ apiKey })
const issue = await client.issue(issueId)
const comments = await issue.comments()
// returns Comment[] { id, body, createdAt }
```

---

## Plane SDK Equivalent

**SDK method**: `client.workItems.comments.list`

```typescript
import { PlaneClient } from '@makeplane/plane-node-sdk'

const client = new PlaneClient({ apiKey })

const response = await client.workItems.comments.list(
  workspaceSlug,
  projectId,
  workItemId,
  { limit: 100 }    // optional pagination
)

// Returns PaginatedResponse<WorkItemComment>
// { results: WorkItemComment[], total_count, next_cursor, ... }

const comments = response.results.map(c => ({
  id: c.id,
  body: c.comment_html,               // HTML, not Markdown
  createdAt: new Date(c.created_at),
}))
```

---

## Key Differences

| Aspect | Linear | Plane |
|--------|--------|-------|
| Scope | `issueId` only | `workspaceSlug` + `projectId` + `workItemId` |
| Body field | `body` (Markdown) | `comment_html` (HTML) |
| Pagination | Returns all (no pagination) | `PaginatedResponse` — paginate with `limit` + `offset` |
| Return type | Flat array | Wrapped in `PaginatedResponse<WorkItemComment>` |
| Author | `user.displayName` on comment | `created_by` is a user ID, not a name |

## Migration Notes

- The comment body is HTML (`comment_html`) in Plane vs Markdown (`body`) in Linear. Convert with an HTML-to-Markdown library if the consumer expects Markdown.
- Plane's list API is paginated. Use `next_cursor` and iterate if `total_count > limit`. For most use cases, setting `limit: 100` (or higher) before pagination is simpler.
- `created_by` in Plane is a user ID; resolve it via `client.workspace.getMembers(workspaceSlug)` if a display name is needed. **Use Option D — In-session workspace member cache** (see [`docs/plane/conflicts/get-issue-comments.md`](conflicts/get-issue-comments.md)): fetch all workspace members once per session and cache the `Map<uuid, displayName>` in-memory, falling back to `email` then the raw UUID. This avoids an extra API call per comment while keeping author names human-readable in LLM output.
- `comment_json` (Tiptap/ProseMirror JSON) is also available alongside `comment_html` for rich-text scenarios.
- Comments have an `access` field (`'INTERNAL'` or `'EXTERNAL'`) with no Linear equivalent — default to `'INTERNAL'`.
