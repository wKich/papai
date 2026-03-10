# Mapping: `removeIssueComment` → Plane SDK

## Linear Implementation

**File**: `src/linear/remove-issue-comment.ts`

```typescript
removeIssueComment({ apiKey, commentId }):
  Promise<{ id: string; success: true }>
```

**Linear SDK call**:
```typescript
const client = new LinearClient({ apiKey })
await client.deleteComment(commentId)
// returns { id: commentId, success: true }
```

---

## Plane SDK Equivalent

**SDK method**: `client.workItems.comments.delete`

```typescript
import { PlaneClient } from '@makeplane/plane-node-sdk'

const client = new PlaneClient({ apiKey })

await client.workItems.comments.delete(
  workspaceSlug,
  projectId,
  workItemId,    // Linear does NOT need this — Plane does
  commentId,
)

// Returns: void
```

---

## Key Differences

| Aspect | Linear | Plane |
|--------|--------|-------|
| Required params | `commentId` only | `workspaceSlug` + `projectId` + `workItemId` + `commentId` |
| Return value | `{ id, success: true }` | `void` |
| Comment lookup | By comment ID globally | Comment ID must be within the known work item scope |

## Migration Notes

- Plane requires `workItemId` (and `projectId`, `workspaceSlug`) to delete a comment, unlike Linear which only needs `commentId`.
- Store the `workItemId` alongside the `commentId` when creating comments, so you can reference it during deletion.
- The return value is `void`; construct `{ id: commentId, success: true }` in the caller if a consistent return shape is needed.
- If only the `commentId` is known, first call `client.workItems.comments.retrieve(...)` to find the associated work item — but this requires knowing the work item upfront anyway.
