# Conflict Report: `add-issue-relation` — `issues` Array Behavior

**Conflict category**: Lower (cosmetic but worth documenting)
**Status**: Resolved — behavior confirmed from backend source

---

## 1. Problem Summary

The Plane SDK's `workItems.relations.create` accepts a payload with an `issues` field that is an array of work item IDs:

```typescript
await client.workItems.relations.create(workspaceSlug, projectId, workItemId, {
  relation_type: 'blocked_by',
  issues: ['id1', 'id2', 'id3'],
})
```

The ambiguity: does passing `N` IDs create `N` independent relations, one "group" relation, process only the first ID, or return an error?

---

## 2. Backend Verification

**Source**: [`apps/api/plane/app/views/issue/relation.py#L209–239`](https://github.com/makeplane/plane/tree/main/apps/api/plane/app/views/issue/relation.py#L209-L239)

```python
def create(self, request, slug, project_id, issue_id):
    relation_type = request.data.get("relation_type", None)
    issues = request.data.get("issues", [])
    project = Project.objects.get(pk=project_id)

    issue_relation = IssueRelation.objects.bulk_create(
        [
            IssueRelation(
                issue_id=(issue if relation_type in ["blocking", "start_after", "finish_after"] else issue_id),
                related_issue_id=(
                    issue_id if relation_type in ["blocking", "start_after", "finish_after"] else issue
                ),
                relation_type=(get_actual_relation(relation_type)),
                project_id=project_id,
                workspace_id=project.workspace_id,
                created_by=request.user,
                updated_by=request.user,
            )
            for issue in issues
        ],
        batch_size=10,
        ignore_conflicts=True,
    )
```

**Conclusion: Answer is (a) — `N` IDs create `N` independent relations.**

The backend iterates every element in `issues` via a list comprehension and calls `bulk_create`, producing one `IssueRelation` database row per ID. This is a true bulk-create endpoint.

The activity task confirms this too — it loops over each element in `issues` to record a separate activity entry per relation created:

```python
# apps/api/plane/bgtasks/issue_activities_task.py#L1299
if current_instance is None and requested_data.get("issues") is not None:
    for related_issue in requested_data.get("issues"):
        issue_activities.append(IssueActivity(...))
```

### Direction swap for `blocking`

For `relation_type in ["blocking", "start_after", "finish_after"]`, the `issue_id` and `related_issue_id` are swapped before inserting. This is because `blocking` is a derived/display relation — the database only stores `blocked_by`. Calling:

```python
create(workspace, project, A_id, { relation_type: "blocking", issues: [B_id] })
```

stores: `issue_id = B_id, related_issue_id = A_id, relation_type = "blocked_by"` — meaning "B is blocked by A", which is equivalent to "A blocks B".

---

## 3. Uniqueness Constraint

**Source**: [`apps/api/plane/db/models/issue.py#L286–311`](https://github.com/makeplane/plane/tree/main/apps/api/plane/db/models/issue.py#L286-L311) and migration 0073

```python
class IssueRelation(ProjectBaseModel):
    issue = models.ForeignKey(Issue, related_name="issue_relation", ...)
    related_issue = models.ForeignKey(Issue, related_name="issue_related", ...)
    relation_type = models.CharField(max_length=20, ...)

    class Meta:
        unique_together = ["issue", "related_issue", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["issue", "related_issue"],
                condition=Q(deleted_at__isnull=True),
                name="issue_relation_unique_issue_related_issue_when_deleted_at_null",
            )
        ]
```

**Critical finding: `relation_type` is NOT part of the uniqueness constraint.**

The constraint is on `(issue, related_issue)` only. This has two important implications:

### You cannot have two different relation types between the same pair

If issue A and issue B already have any relation, attempting to add a different relation type between them will be silently ignored (`ignore_conflicts=True`). The database enforces that there can be at most **one** relation record per `(issue_id, related_issue_id)` pair.

Example: if `A blocked_by B` exists, calling create with `A relates_to B` will produce no new row — `ignore_conflicts=True` swallows the conflict without raising an error.

### `remove_relation` deletes by pair, regardless of type

```python
# apps/api/plane/app/views/issue/relation.py#L261-L284
def remove_relation(self, request, slug, project_id, issue_id):
    related_issue = request.data.get("related_issue", None)

    issue_relations = IssueRelation.objects.filter(
        workspace__slug=slug,
    ).filter(
        Q(issue_id=related_issue, related_issue_id=issue_id)
        | Q(issue_id=issue_id, related_issue_id=related_issue)
    )
    issue_relations = issue_relations.first()
    issue_relations.delete()
```

The filter is on the issue pair only — no `relation_type` filter. Since the uniqueness constraint ensures at most one row per pair, `.first()` always finds the single existing relation and deletes it. Passing a `relation_type` in the request body is ignored by this endpoint.

---

## 4. Bulk Creation Analysis

### Is passing multiple IDs safe?

Yes. The backend was explicitly designed for bulk creation — a single POST creates all requested relations atomically via `bulk_create`. There is no risk of partial failure for individual IDs; if a conflict occurs for one ID the row is skipped and the others proceed.

### Is it useful for the Linear migration use case?

Linear stores one relation per `createIssueRelation` call, meaning it is always a single `(issueId, relatedIssueId, type)` tuple. The migration code should always pass `issues: [singleId]`.

Bulk creation would be useful only if migrating a batch of pre-grouped relations (e.g., "issue A blocks issues B, C, and D" in a single API call). But since Linear's `IssueRelation` is always one-to-one, bulk creation adds complexity without benefit.

### SDK field name inconsistency

The Context7 docs for `@makeplane/plane-node-sdk` show `related_list` as the field name:

```typescript
// Context7 SDK docs (possibly stale)
await client.workItems.relations.create('workspace', 'project-id', 'work-item-id', {
  related_list: ['related-work-item-id'],
  relation_type: 'blocked_by',
})
```

However, the Plane frontend source (`IssueRelationService`) and the backend (`request.data.get("issues", [])`) both use `issues` as the field name. The live Plane app uses:

```typescript
// apps/web/core/services/issue/issue_relation.service.ts
data: { relation_type: TIssueRelationTypes; issues: string[] }
```

**Use `issues`, not `related_list`.** The SDK docs appear to reference a historical or alternate schema version.

---

## 5. Recommended Approach

Always use single-element arrays matching Linear's one-at-a-time interface.

```typescript
await client.workItems.relations.create(
  workspaceSlug,
  projectId,
  workItemId, // source issue
  {
    relation_type: planeRelationType,
    issues: [relatedWorkItemId], // single-element array
  },
)
```

This is also what the Plane frontend itself does in `createCurrentRelation`:

```typescript
// apps/web/core/store/issue/issue-details/relation.store.ts#L208
await this.issueRelationService.createIssueRelations(workspaceSlug, projectId, issueId, {
  relation_type: relationType,
  issues: [relatedIssueId], // always single
})
```

---

## 6. Implementation Notes

### Linear → Plane type mapping

| Linear type  | Plane `relation_type` (in request) | Stored as (in DB)      |
| ------------ | ---------------------------------- | ---------------------- |
| `blocks`     | `"blocking"`                       | `blocked_by` (swapped) |
| `duplicate`  | `"duplicate"`                      | `duplicate`            |
| `related`    | `"relates_to"`                     | `relates_to`           |
| _(incoming)_ | `"blocked_by"`                     | `blocked_by`           |

### TypeScript pattern

```typescript
import type { RelationType } from '@makeplane/plane-node-sdk'

const linearTypeToPlane: Record<'blocks' | 'duplicate' | 'related', RelationType> = {
  blocks: 'blocking',
  duplicate: 'duplicate',
  related: 'relates_to',
}

async function addIssueRelation(
  workspaceSlug: string,
  projectId: string,
  issueId: string,
  relatedIssueId: string,
  linearType: 'blocks' | 'duplicate' | 'related',
): Promise<void> {
  await client.workItems.relations.create(workspaceSlug, projectId, issueId, {
    relation_type: linearTypeToPlane[linearType],
    issues: [relatedIssueId],
  })
  // Returns void — no relation ID to store.
  // Use (issueId, relatedIssueId, relation_type) as the composite key.
}
```

### No relation ID — composite key only

`create` returns `void`. Unlike Linear, Plane does not return a relation object with its own ID. The only identifier for a relation is the tuple `(issue_id, related_issue_id)` — and due to the uniqueness constraint, there is at most one relation per pair regardless of type.

---

## 7. Error Handling

### Duplicate pair: silently ignored

The backend uses `ignore_conflicts=True`. If a relation between the pair already exists (any type), the creation is a no-op — no exception, no error response, no indication that the request was a duplicate. The response will contain an empty list or only the successfully created relations.

**Implication**: calling `addIssueRelation(A, B, 'relates_to')` when `A blocked_by B` already exists will succeed with HTTP 201 but store nothing new. The existing `blocked_by` relation remains unchanged.

### Defensive pattern for idempotent migration

```typescript
// Before creating, check if a relation already exists
// (requires a separate GET call to the list endpoint)
async function ensureRelation(
  workspaceSlug: string,
  projectId: string,
  issueId: string,
  relatedIssueId: string,
  linearType: 'blocks' | 'duplicate' | 'related',
): Promise<void> {
  const relations = await client.workItems.relations.list(workspaceSlug, projectId, issueId)

  const planeType = linearTypeToPlane[linearType]

  // Check if any relation exists between the pair
  const allIds = Object.values(relations).flat()
  if (allIds.includes(relatedIssueId)) {
    logger.warn({ issueId, relatedIssueId }, 'Relation already exists, skipping')
    return
  }

  await client.workItems.relations.create(workspaceSlug, projectId, issueId, {
    relation_type: planeType,
    issues: [relatedIssueId],
  })
}
```

However, for a migration scenario where duplicate relations are not expected, relying on `ignore_conflicts=True` is acceptable and simpler — the silent conflict suppression is intentional by design.

### Wrong `relation_type`

If `relation_type` is omitted, the backend returns HTTP 400:

```json
{ "message": "Issue relation type is required" }
```

### Both issues must exist

The foreign key constraints on `issue` and `related_issue` mean passing a non-existent ID will raise an `IntegrityError` (HTTP 400 or 500 depending on the view's error handling). Validate that both issues are migrated before creating their relation.

---

## Summary

| Question                                           | Answer                                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `issues: ['id1', 'id2']` — 2 relations or 1?       | **2 separate relations** (bulk_create, one row per ID)                                 |
| Can A have both `blocked_by B` and `relates_to B`? | **No** — uniqueness is on `(issue, related_issue)` only, ignoring `relation_type`      |
| What happens if the pair already exists?           | **Silent no-op** (`ignore_conflicts=True`)                                             |
| Is there a maximum array size?                     | No explicit limit, `batch_size=10` controls DB batching internally                     |
| Should we use single-element arrays?               | **Yes** — matches Linear's one-at-a-time semantics and is what the Plane frontend does |
| Correct field name: `issues` or `related_list`?    | **`issues`** — the SDK docs show `related_list` but the backend expects `issues`       |
