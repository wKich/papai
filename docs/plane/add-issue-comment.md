# Mapping: `addIssueComment` → Plane SDK

## Linear Implementation

**File**: `src/linear/add-issue-comment.ts`

```typescript
addIssueComment({ apiKey, issueId, body }):
  Promise<{ id: string; body: string; url: string }>
```

**Linear SDK call**:
```typescript
const client = new LinearClient({ apiKey })
const payload = await client.createComment({ issueId, body })
const comment = await payload.comment
// returns { id, body, url }
```

---

## Plane SDK Equivalent

**SDK method**: `client.workItems.comments.create`

```typescript
import { PlaneClient } from '@makeplane/plane-node-sdk'

const client = new PlaneClient({ apiKey })

const comment = await client.workItems.comments.create(
  workspaceSlug,   // replaces apiKey-scoped workspace
  projectId,       // Linear: issueId is enough; Plane: needs projectId too
  workItemId,      // Linear: issueId → Plane: workItemId
  {
    comment_html: `<p>${body}</p>`,  // Plane uses HTML, Linear uses Markdown body
  }
)

// Returns: WorkItemComment
// { id, comment_html, comment_json, access, created_at, updated_at, ... }
```

---

## Key Differences

| Aspect | Linear | Plane |
|--------|--------|-------|
| Scope | `issueId` sufficient | Requires `workspaceSlug` + `projectId` + `workItemId` |
| Body format | Plain Markdown string (`body`) | HTML string (`comment_html`) |
| Return value | `{ id, body, url }` | `WorkItemComment` object (no `url` field) |
| URL | Comment has direct `url` property | Must construct URL manually |

## Migration Notes

- The caller must supply `workspaceSlug` and `projectId` in addition to the work item ID.
- `body` (Markdown) must be wrapped in HTML tags: a plain paragraph becomes `<p>${body}</p>`.
- The returned object does not include a direct `url`; construct it as `${baseUrl}/${workspaceSlug}/projects/${projectId}/issues/${workItemId}#comment-${comment.id}`.
- `comment_json` can be omitted — Plane will derive it from `comment_html`.
