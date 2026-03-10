# Mapping: `updateIssueComment` → Plane SDK

## Linear Implementation

**File**: `src/linear/update-issue-comment.ts`

```typescript
updateIssueComment({ apiKey, commentId, body }):
  Promise<{ id: string; body: string; url: string }>
```

**Linear SDK call**:
```typescript
const client = new LinearClient({ apiKey })
const payload = await client.updateComment(commentId, { body })
const comment = await payload.comment
// returns { id, body, url }
```

---

## Plane SDK Equivalent

**SDK method**: `client.workItems.comments.update`

```typescript
import { PlaneClient } from '@makeplane/plane-node-sdk'

const client = new PlaneClient({ apiKey })

const updated = await client.workItems.comments.update(
  workspaceSlug,
  projectId,
  workItemId,     // Linear does NOT require this — Plane does
  commentId,
  {
    comment_html: `<p>${body}</p>`,   // Linear: Markdown → Plane: HTML
  }
)

// Returns updated WorkItemComment
// { id, comment_html, comment_json, access, updated_at, ... }
```

---

## Key Differences

| Aspect | Linear | Plane |
|--------|--------|-------|
| Required params | `commentId` + `body` | `workspaceSlug` + `projectId` + `workItemId` + `commentId` + `comment_html` |
| Body format | Markdown string `body` | HTML string `comment_html` |
| Return value | `{ id, body, url }` | Full `WorkItemComment` object (no `url`) |
| URL | Direct `url` property | Must construct manually |

## Migration Notes

- Plane requires the parent `workItemId` (and `projectId`, `workspaceSlug`) to update a comment. Store these alongside the `commentId` at creation time.
- `body` (Markdown) must be converted to HTML for `comment_html`. Wrap plain text in `<p>...</p>` or use a Markdown-to-HTML library.
- The returned `WorkItemComment` does not have a `url` field; construct it as: `${baseUrl}/${workspaceSlug}/projects/${projectId}/issues/${workItemId}#comment-${commentId}`.
- `comment_json` (ProseMirror/Tiptap JSON) is updated automatically by Plane from the HTML; you generally don't need to provide it.
- If the `body` contains Markdown formatting (bold, lists, etc.), convert accurately to HTML to preserve structure.
