# Research: `update-issue-relation` Conflict (Linear → Plane)

**Date**: March 10, 2026  
**Sources**: Plane SDK GitHub source, Plane backend source (`relation.py`), Context7 docs, Plane issue tracker

---

## 1. Problem Summary

Linear exposes a direct `updateIssueRelation(relationId, { type })` method that atomically changes a relation's type in a single API call. Plane has no equivalent. The only available SDK operations are:

- `relations.create(workspaceSlug, projectId, workItemId, { relation_type, issues })`
- `relations.delete(workspaceSlug, projectId, workItemId, { related_issue })`
- `relations.list(workspaceSlug, projectId, workItemId)`

Updating a relation type therefore requires two sequential calls: delete the existing relation, then recreate it with the new type. This window between the two calls is non-atomic — if the create step fails, the relation is permanently lost with no built-in rollback.

---

## 2. SDK / API Verification

### 2.1 SDK delete signature (confirmed)

From the SDK source at `src/api/WorkItems/Relations.ts` and the type model `WorkItemRelationRemoveRequest`:

```typescript
// WorkItemRelationRemoveRequest (models/WorkItemRelation.ts)
export interface WorkItemRelationRemoveRequest {
  related_issue: string; // ID of the related work item
  // NO relation_type field
}

// SDK implementation
async delete(
  workspaceSlug: string,
  projectId: string,
  workItemId: string,
  relationData: WorkItemRelationRemoveRequest
): Promise<void> {
  return this.post(
    `/workspaces/${workspaceSlug}/projects/${projectId}/work-items/${workItemId}/relations/remove/`,
    relationData
  );
}
```

**Important correction re: Context7 docs**: The Context7 snippet for `relations.delete` showed `{ related_list: string[], relation_type: string }`. This is **incorrect** — it does not match the actual SDK source. The real interface is `{ related_issue: string }` only.

### 2.2 Backend `remove_relation` implementation (confirmed from Plane source)

From `apps/api/plane/app/views/issue/relation.py`:

```python
def remove_relation(self, request, slug, project_id, issue_id):
    related_issue = request.data.get("related_issue", None)

    issue_relations = IssueRelation.objects.filter(
        workspace__slug=slug,
    ).filter(
        Q(issue_id=related_issue, related_issue_id=issue_id)
        | Q(issue_id=issue_id, related_issue_id=related_issue)
    )
    issue_relations = issue_relations.first()
    # ...
    issue_relations.delete()
```

Key observations:

- `relation_type` is **not read** from request data and **not used** in the filter
- The filter uses OR across both orderings of the pair: `(A, B)` and `(B, A)`
- `.first()` selects and deletes **only one row**

### 2.3 Database uniqueness constraint (confirmed from Plane model)

From `apps/api/plane/db/models/issue.py`:

```python
class IssueRelation(ProjectBaseModel):
    issue = models.ForeignKey(Issue, ...)
    related_issue = models.ForeignKey(Issue, ...)
    relation_type = models.CharField(...)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["issue", "related_issue"],       # NOTE: no "relation_type"
                condition=Q(deleted_at__isnull=True),
                name="issue_relation_unique_...",
            )
        ]
```

The unique constraint is on `(issue, related_issue)` — **not** on `(issue, related_issue, relation_type)`. Only one active relation can exist per ordered pair direction. Two issues can have **at most two rows**: `(A, B, type1)` and `(B, A, type2)`.

### 2.4 Does delete remove ONE or ALL relations?

The backend uses `.first()` so it deletes **exactly one row**. Since the filter matches both `(A, B, *)` and `(B, A, *)`:

- If only one direction exists (the common case): deletes it correctly
- If both directions exist simultaneously (two issues with relations in both directions): only the `.first()` result is deleted — which one depends on the queryset ordering (`-created_at`) and is not deterministic from the caller's perspective

**Conclusion**: `relations.delete({ related_issue: B })` will delete one relation — typically the correct one for simple cases, but unreliable when a pair has relations in both directions.

### 2.5 Public API status

The external public API at `developers.plane.so/api/v1/...` does **not** yet expose a relations endpoint. This is a known open issue ([#6236](https://github.com/makeplane/plane/issues/6236) — still open as of March 2026). The Node SDK targets the internal app API path (without `/v1/`), meaning it relies on Plane's internal — not officially public — infrastructure.

---

## 3. Alternative Solutions

### Option A — Delete + Recreate with Compensating Rollback (optimistic safeguard)

**Pattern**: Read current state before delete, attempt delete, attempt create, restore on failure.

**How it works**:

1. Call `relations.list` to capture the existing relation type
2. Call `relations.delete({ related_issue })`
3. Call `relations.create({ relation_type: newType, issues: [relatedIssueId] })`
4. On create failure: attempt `relations.create({ relation_type: oldType, issues: [relatedIssueId] })` to restore

**Pros**:

- Stays entirely within the existing SDK interface
- Restores the original relation on create failure
- Adds visibility into what was actually deleted

**Cons**:

- The rollback `create` can also fail, leaving no relation at all
- Three network calls in the happy path (list + delete + create), four in rollback
- Adds latency
- Between delete and create, the relation is transiently missing — observable by concurrent readers

**Risk rating**: Medium. Reduces data loss probability to the intersection of two independent failures, but doesn't eliminate it.

---

### Option B — Skip Delete If Type Matches (no-op early exit)

**Pattern**: Read current state, compare, only mutate if the type is actually changing.

**How it works**:

1. Call `relations.list` to get the current relation type
2. Map the current Plane type back to the Linear type
3. If the current type already matches the requested new type, return immediately
4. Otherwise proceed with delete + create (optionally with compensating rollback from Option A)

**Pros**:

- Eliminates unnecessary deletes when someone "updates" to the same type (idempotent re-runs, migrations)
- Strictly safer than always deleting
- Simple to implement

**Cons**:

- Not a solution to the atomicity problem — only avoids triggering it when unnecessary
- An extra round-trip on every call where the type actually changes
- The `relations.list` data can be stale by the time delete happens

**Risk rating**: Low additional risk relative to the baseline — this is a strict improvement over always deleting. Best used as a precondition, not as a standalone solution.

---

### Option C — Accept Non-Atomicity, Detect and Report Loss

**Pattern**: Proceed with delete + create, verify the final state, surface an error to the caller if the state is wrong.

**How it works**:

1. Call `relations.delete({ related_issue })`
2. Call `relations.create({ relation_type: newType, issues: [relatedIssueId] })`
3. On create failure: call `relations.list` and check whether any relation still exists between the pair
4. Return a detailed error distinguishing:
   - "Type changed but relation was lost" → should trigger an alert or retry
   - "Create succeeded" → normal

**Pros**:

- Minimal complexity
- Makes the failure mode explicit and observable rather than silent
- Caller decides whether to retry or report

**Cons**:

- Silent data loss remains possible if neither delete nor create throws (e.g. 2xx with partial failure)
- No automatic recovery
- Adds a verification round-trip only on the failure path — does not prevent loss

**Risk rating**: Medium. Acceptable when update operations are infrequent and the system has human oversight (e.g. migration tooling with logs).

---

### Option D — Two-Phase: Dual-Write with Deferred Delete

**Pattern**: Create the new relation first, then delete the old one.

**How it works**:

1. Call `relations.create` with the **new** type
2. If create succeeds, call `relations.delete` to remove the **old** relation
3. If delete fails: attempt again with exponential backoff; log if it remains

**Problem**: The database unique constraint on `(issue, related_issue)` prevents two active relations in the same direction. If the old relation is `(A, B, blocked_by)` and the new one is `(A, B, relates_to)` — both stored in the same direction — `create` will be rejected with a conflict error (409), making this pattern impossible for same-direction type changes.

If the old type and new type are stored in opposite directions (e.g. `(B, A, blocked_by)` → `(A, B, relates_to)`), then the two rows don't conflict. In that narrow case, the dual-write works. But this is highly relation-type dependent and fragile.

**Verdict**: Not viable as a general solution due to the unique constraint.

---

### Option E — REST API Direct Call with `relation_type` in Body

The Plane web frontend's internal `IssueRelationService` sends `{ relation_type, related_issue }` to `/api/.../remove-relation/`. Although the backend currently ignores `relation_type`, calling the endpoint directly (bypassing the SDK) allows you to send both fields — making the code forward-compatible if Plane ever adds `relation_type` filtering to the delete endpoint.

**Pros**:

- Sends semantically complete data
- Code survives a future Plane fix without changes
- No additional round-trips versus plain SDK usage

**Cons**:

- Bypasses the SDK's abstraction and type safety
- The endpoint path is on the internal API (not `v1/`), subject to change without public notice
- Still non-atomic; `relation_type` is currently ignored by the backend

**Risk rating**: Low effort, medium maintenance risk.

---

## 4. Decision

**Chosen: Option B — no-op early exit.**

The no-op guard (list → compare → skip if unchanged) is the correct foundation. It eliminates the dangerous delete+create for the common cases where the relation type is already correct (idempotent re-runs, retries, migrations), and does so with minimal complexity.

Options A and C (compensating rollback and loss detection) add complexity and additional network round-trips for error paths that are unlikely in practice. They can be added later if operational evidence shows the double-failure scenario is a real concern.

---

**Original recommended approach (for reference)**:

**Combine Options B + A + C**: no-op guard → delete + recreate with compensating rollback → structured error on double failure.

Rationale:

- **Option B** (no-op guard) eliminates the dangerous delete+recreate for idempotent calls — which are common in migration and sync scenarios
- **Option A** (compensating rollback) reduces the probability of permanent data loss from "any create failure" to "both create and rollback-create fail simultaneously" — a much smaller window
- **Option C** (detect loss) gives the caller actionable error information when both attempts fail

The combination is simple, uses only the existing SDK, and degrades gracefully: each layer independently reduces failure probability.

Do **not** implement Option D (dual-write) — it breaks against the uniqueness constraint.

---

## 5. Implementation Sketch

```typescript
import type { PlaneClient } from '@makeplane/plane-node-sdk'

type RelationType =
  | 'blocking'
  | 'blocked_by'
  | 'duplicate'
  | 'relates_to'
  | 'start_before'
  | 'start_after'
  | 'finish_before'
  | 'finish_after'

interface UpdateRelationResult {
  success: boolean
  // true if delete succeeded but create failed (relation was lost and rollback also failed)
  relationLost: boolean
  error?: string
}

async function updateWorkItemRelation(
  client: PlaneClient,
  workspaceSlug: string,
  projectId: string,
  workItemId: string,
  relatedItemId: string,
  newRelationType: RelationType,
): Promise<UpdateRelationResult> {
  // Step 1: Read current state to enable rollback and no-op detection
  const existing = await client.workItems.relations.list(workspaceSlug, projectId, workItemId)

  // Step 2: Find the current relation type for this pair
  const currentType = findCurrentRelationType(existing, relatedItemId)

  // Step 3: No-op guard — skip if already correct
  if (currentType === newRelationType) {
    return { success: true, relationLost: false }
  }

  if (currentType === null) {
    // No relation exists — cannot update what doesn't exist
    return {
      success: false,
      relationLost: false,
      error: `No relation found between ${workItemId} and ${relatedItemId}`,
    }
  }

  // Step 4: Delete the existing relation
  await client.workItems.relations.delete(workspaceSlug, projectId, workItemId, {
    related_issue: relatedItemId,
  })

  // Step 5: Create the new relation
  try {
    await client.workItems.relations.create(workspaceSlug, projectId, workItemId, {
      relation_type: newRelationType,
      issues: [relatedItemId],
    })
    return { success: true, relationLost: false }
  } catch (createError) {
    // Step 6: Create failed — attempt compensating rollback
    try {
      await client.workItems.relations.create(workspaceSlug, projectId, workItemId, {
        relation_type: currentType,
        issues: [relatedItemId],
      })
      // Rollback succeeded — relation exists again with original type, but update failed
      return {
        success: false,
        relationLost: false,
        error: `Failed to set new relation type; original type restored. Cause: ${String(createError)}`,
      }
    } catch (rollbackError) {
      // Both create and rollback failed — relation is gone
      return {
        success: false,
        relationLost: true,
        error:
          `CRITICAL: relation lost between ${workItemId} and ${relatedItemId}. ` +
          `Create error: ${String(createError)}. Rollback error: ${String(rollbackError)}`,
      }
    }
  }
}

function findCurrentRelationType(
  relations: {
    blocking: string[]
    blocked_by: string[]
    duplicate: string[]
    relates_to: string[]
    start_after: string[]
    start_before: string[]
    finish_after: string[]
    finish_before: string[]
  },
  relatedItemId: string,
): RelationType | null {
  for (const [type, ids] of Object.entries(relations)) {
    if ((ids as string[]).includes(relatedItemId)) {
      return type as RelationType
    }
  }
  return null
}
```

---

## 6. Remaining Risks

### 6.1 Double failure window

The compensating rollback still fails if the Plane server is unreachable between the delete and rollback-create calls (e.g. a transient outage). In that case `relationLost: true` is returned. The caller must log this and surface it for manual correction.

### 6.2 Concurrent modification

If another process creates or deletes a relation on the same pair between the `list` call and the `delete` call, the delete may remove the wrong relation or fail unexpectedly. There is no locking mechanism available.

### 6.3 Direction-dependent ambiguity

Some relation types encode directionality that is flipped by the Plane backend during storage (e.g. `blocking` is stored as `blocked_by` from the related issue's perspective). The `list` response already normalizes this — the type visible in `list` for a given `workItemId` is what the caller should pass to `delete` and `create`. However, the mapping must stay consistent with how the backend stores and queries relations.

### 6.4 SDK targets internal API

The SDK's `/relations/remove/` path targets Plane's internal app API, **not** the public `/api/v1/` API which lacks a relations endpoint entirely (as of March 2026). If Plane changes the internal endpoint path or moves relations exclusively to v1, the SDK breaks silently. Monitor [Plane issue #6236](https://github.com/makeplane/plane/issues/6236) for the public API timeline.

### 6.5 No `relation_type` filter in delete

The backend `remove_relation` ignores `relation_type`. If two issues ever have simultaneous relations in both directions (e.g. `A blocks B` AND `B relates_to A`), a `delete({related_issue: B})` from A's perspective will only remove one of them — and which one is determined by `ORDER BY -created_at` / `.first()`. This is an edge case that the Plane UI also doesn't protect against (the search endpoint excludes already-related issues, preventing duplicate relations of the same kind).

### 6.6 Context7 documentation inaccuracy

The Context7 snippet for `relations.delete` showed `{ related_list: string[], relation_type: string }` as the delete body. This is **incorrect** based on the actual SDK source and backend implementation. Any implementation relying on `relation_type` in the delete call should not expect it to have any effect today.
