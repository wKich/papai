# Mapping: `addIssueRelation` → Plane SDK

## Linear Implementation

**File**: `src/linear/add-issue-relation.ts`

```typescript
addIssueRelation({ apiKey, issueId, relatedIssueId, type }):
  Promise<{ id: string; type: string }>
// type: 'blocks' | 'duplicate' | 'related'
```

**Linear SDK call**:

```typescript
const typeMap = {
  blocks: IssueRelationType.Blocks,
  duplicate: IssueRelationType.Duplicate,
  related: IssueRelationType.Related,
}
const client = new LinearClient({ apiKey })
const payload = await client.createIssueRelation({
  issueId,
  relatedIssueId,
  type: typeMap[type],
})
const relation = await payload.issueRelation
// returns { id, type }
```

---

## Plane SDK Equivalent

**SDK method**: `client.workItems.relations.create`

### Type mapping: Linear → Plane

| Linear `type` | Plane `relation_type` (in request) | Stored in DB as        | Notes                                                          |
| ------------- | ---------------------------------- | ---------------------- | -------------------------------------------------------------- |
| `blocks`      | `'blocking'`                       | `blocked_by` (swapped) | Plane stores `blocked_by`; the `blocking` direction is derived |
| `duplicate`   | `'duplicate'`                      | `duplicate`            | Same concept, same direction                                   |
| `related`     | `'relates_to'`                     | `relates_to`           | Same concept                                                   |

### Complete implementation

```typescript
import type { RelationType } from '@makeplane/plane-node-sdk'
import { PlaneClient } from '@makeplane/plane-node-sdk'

const typeMap: Record<'blocks' | 'duplicate' | 'related', RelationType> = {
  blocks: 'blocking', // stored as blocked_by with direction swapped
  duplicate: 'duplicate',
  related: 'relates_to',
}

export async function addIssueRelation({
  apiKey,
  workspaceSlug,
  projectId,
  issueId, // Linear: issueId → Plane: workItemId (source)
  relatedIssueId, // Linear: relatedIssueId → Plane: issues[0] (target)
  type,
}: {
  apiKey: string
  workspaceSlug: string
  projectId: string
  issueId: string
  relatedIssueId: string
  type: 'blocks' | 'duplicate' | 'related'
}): Promise<void> {
  const client = new PlaneClient({ apiToken: apiKey })

  await client.workItems.relations.create(workspaceSlug, projectId, issueId, {
    relation_type: typeMap[type],
    issues: [relatedIssueId], // always single-element; see notes below
  })
  // Returns void — no relation object.
  // Use (issueId, relatedIssueId) as composite key for future deletes.
}
```

---

## Key Differences

| Aspect          | Linear                           | Plane                                                                                                               |
| --------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Return value    | Relation object `{ id, type }`   | `void` — no object returned                                                                                         |
| Relation ID     | Has own `id`                     | None — identified by `(workItemId, relatedIssueId)` pair                                                            |
| Type vocabulary | `blocks`, `duplicate`, `related` | `blocking`, `blocked_by`, `duplicate`, `relates_to`, `start_before`, `start_after`, `finish_before`, `finish_after` |
| Scope           | Global by `issueId`              | Requires `workspaceSlug` + `projectId`                                                                              |
| `issues` field  | N/A                              | Array — but always pass single-element                                                                              |
| Duplicate pair  | Error                            | **Silent no-op** (`ignore_conflicts=True`)                                                                          |

---

## Critical Behavioral Notes

### SDK docs field name is wrong

The `@makeplane/plane-node-sdk` documentation shows `related_list` as the payload field name. **Use `issues` instead.** The backend expects `request.data.get("issues", [])`. The SDK docs appear to reference an outdated schema version; the live Plane frontend and backend both use `issues`.

### No relation ID — composite key only

`create` returns `void`. Plane has no per-relation ID. The only stable identifier for a relation is the pair `(issueId, relatedIssueId)`. Store this pair if you need to delete or update the relation later.

### One relation type per pair — silently enforced

The uniqueness constraint is on `(issue, related_issue)` only — **`relation_type` is not part of it**. This means:

- You cannot have both `blocked_by` and `relates_to` between the same two issues simultaneously.
- If any relation already exists between the pair, calling `create` with a different type is a **silent no-op** — HTTP 201, no error, nothing stored. The original relation is unchanged.
- Always use `remove_issue_relation` → `add_issue_relation` to change the type (there is no native update).

### `blocking` direction swap

For `relation_type = 'blocking'`, the Plane backend swaps `issue_id` and `related_issue_id` before inserting:

```
create(workspace, project, A_id, { relation_type: 'blocking', issues: [B_id] })
→ stored as: issue_id = B_id, related_issue_id = A_id, relation_type = 'blocked_by'
→ meaning: "B is blocked by A" = "A blocks B" ✓
```

This matches Linear's `blocks` direction exactly. No special handling needed in the migration code.

### `issues` array creates N independent relations

Passing multiple IDs — `issues: ['id1', 'id2']` — creates **two separate relation rows** via `bulk_create`. Linear stores one relation per call, so always pass a single-element array. Bulk creation adds no value for Linear migration.

### Both issues must exist in Plane before creating the relation

Foreign key constraints will raise an error (HTTP 400/500) if either ID doesn't exist in Plane yet. Ensure both issues are migrated before migrating their relations.

### Cross-project relations are not supported

Both issues must belong to the same `projectId`. If a Linear relation crosses projects, you will need to locate the Plane `projectId` for the related issue separately before calling `create`.

---

## Error Handling

| Scenario                                        | Plane behavior                                               |
| ----------------------------------------------- | ------------------------------------------------------------ |
| Relation between pair already exists (any type) | Silent no-op — HTTP 201, nothing stored                      |
| `relation_type` omitted                         | HTTP 400: `{ "message": "Issue relation type is required" }` |
| Either issue ID doesn't exist                   | HTTP 400/500 — database integrity error                      |
| Invalid `relation_type` value                   | HTTP 400 — validation error                                  |

---

## Migration Notes

- **Return value shim**: Linear callers expect `{ id: string; type: string }`. Since Plane returns `void`, build the response from the input: `{ id: issueId, type }`.
- **Update is not atomic**: To change a relation type, use `delete` + `create` sequentially. If `create` fails after `delete`, the relation is gone. Add retry logic for production use.
- **Plane supports 8 relation types** (`blocking`, `blocked_by`, `duplicate`, `relates_to`, `start_before`, `start_after`, `finish_before`, `finish_after`). The four extras are timeline-dependency types with no Linear equivalent and are out of scope for migration.
- **Idempotent migration**: The silent `ignore_conflicts=True` behavior on duplicates means re-running migration is safe — duplicate creates are no-ops. No pre-flight check needed unless you need to detect type mismatches.
