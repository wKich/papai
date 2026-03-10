# Mapping: `updateIssueRelation` → Plane SDK

## Linear Implementation

**File**: `src/linear/update-issue-relation.ts`

```typescript
updateIssueRelation({ apiKey, issueId, relatedIssueId, type }):
  Promise<{ id: string; type: string; relatedIssueId: string }>
// type: 'blocks' | 'duplicate' | 'related'
```

**Linear SDK call**:

```typescript
const client = new LinearClient({ apiKey })
// 1. Finds relation ID via findRelationByRelatedIssueId
// 2. await client.updateIssueRelation(relationId, { type: typeMap[type] })
// Returns { id, type, relatedIssueId }
```

---

## Plane SDK Equivalent

**There is no `update` method for relations in Plane.** Relations must be deleted and recreated with the new type.

**Chosen approach: Option B — no-op early exit.** Before deleting, list the current relations and check whether the type is already correct. Skip the delete+create entirely if it is. This avoids the non-atomic mutation window when no change is needed (idempotent calls, retries, migrations).

See [`docs/plane/conflicts/update-issue-relation.md`](./conflicts/update-issue-relation.md) for full analysis.

**SDK methods**: `client.workItems.relations.list` + `client.workItems.relations.delete` + `client.workItems.relations.create`

```typescript
import { PlaneClient } from '@makeplane/plane-node-sdk'

const client = new PlaneClient({ apiKey })

// Relation type mapping: Linear → Plane
const typeMap: Record<string, string> = {
  blocks: 'blocking',
  duplicate: 'duplicate',
  related: 'relates_to',
}

const planeType = typeMap[type]

// Step 1: Read current state — enables no-op guard
const existing = await client.workItems.relations.list(workspaceSlug, projectId, workItemId)

// Step 2: No-op guard — skip if already correct
const currentType = findCurrentRelationType(existing, relatedWorkItemId)
if (currentType === planeType) {
  return { id: workItemId, type, relatedIssueId: relatedWorkItemId }
}

// Step 3: Delete the existing relation
await client.workItems.relations.delete(workspaceSlug, projectId, workItemId, { related_issue: relatedWorkItemId })

// Step 4: Recreate with the new type
await client.workItems.relations.create(workspaceSlug, projectId, workItemId, {
  relation_type: planeType,
  issues: [relatedWorkItemId],
})

// No return value from Plane — construct manually:
return { id: workItemId, type, relatedIssueId: relatedWorkItemId }
```

**`findCurrentRelationType` helper:**

```typescript
// relations.list returns an object keyed by type, each value being an array of issue IDs
function findCurrentRelationType(relations: Record<string, string[]>, relatedIssueId: string): string | null {
  for (const [relType, ids] of Object.entries(relations)) {
    if (ids.includes(relatedIssueId)) return relType
  }
  return null
}
```

---

## Key Differences

| Aspect          | Linear                                             | Plane                                                                |
| --------------- | -------------------------------------------------- | -------------------------------------------------------------------- |
| Operation       | Native `updateIssueRelation(relationId, { type })` | No update — must delete + recreate                                   |
| Atomicity       | Single API call                                    | Two sequential API calls                                             |
| Relation ID     | Has own ID                                         | No persistent ID — identified by `(workItemId, relatedIssueId)` pair |
| Return value    | `{ id, type, relatedIssueId }`                     | `void` + `void` — construct manually                                 |
| Type vocabulary | `blocks`, `duplicate`, `related`                   | `blocking`, `duplicate`, `relates_to`                                |

## Migration Notes

- **No atomic update**: The delete-then-create pattern is non-atomic. If `create` fails after `delete`, the relation is lost. Consider wrapping in retry logic.
- Plane's `delete` removes the relation between `(workItemId, relatedIssueId)` regardless of direction or type. Verify this doesn't remove multiple relations if the pair has more than one.
- The `findRelationByRelatedIssueId` helper used in Linear is not needed in Plane — just provide the pair directly.
- When constructing the return value, type should be the updated Plane type string (e.g. `'blocking'`), not the Linear original.
