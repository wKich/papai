# Conflict Deep-Dive: `removeIssueRelation`

**Date**: March 10, 2026  
**Severity**: Critical  
**Status**: Workaround exists — see [Recommended Approach](#5-recommended-approach)

---

## 1. Problem Summary

Linear's `removeIssueRelation` removes a specific typed relation between two issues. The caller identifies which relation by `(issueId, relatedIssueId, type)`:

```typescript
// Linear
removeIssueRelation({ apiKey, issueId, relatedIssueId, type })
// type: 'blocks' | 'duplicate' | 'related'
```

The Plane Node SDK's `workItems.relations.delete` accepts only a `{ related_issue }` identifier — no type parameter:

```typescript
// SDK published type (v0.2.8, WorkItemRelationRemoveRequest)
interface WorkItemRelationRemoveRequest {
  related_issue: string
}
```

If two work items have more than one relation type between them (e.g., both `blocking` and `relates_to`), the current API provides no way to select which one is removed.

---

## 2. API Verification

### 2.1 SDK v1 endpoint does not exist

The SDK calls `POST /api/v1/workspaces/{ws}/projects/{pr}/work-items/{id}/relations/remove/`, but **this endpoint does not exist** in the Plane v1 REST API as of March 2026. GitHub issue [#6236 `feat: issue-relation support in API`](https://github.com/makeplane/plane/issues/6236) has been open since December 2024 and is not yet resolved. User `@glitchedmob` confirmed in January 2026:

> "It seems like the Python and Node SDKs make assumptions that the endpoint this feature is asking for already exists."

Calling `client.workItems.relations.delete(...)` will return a 404 on a standard Plane install.

### 2.2 Working endpoint: the internal app API

The Plane web application uses a different, older endpoint that _does_ work:

```
POST /api/workspaces/{slug}/projects/{project_id}/issues/{issue_id}/remove-relation/
Body: { related_issue: string, relation_type?: string }
```

Registered in `apps/api/plane/app/urls/issue.py`:

```python
path(
    "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/remove-relation/",
    IssueRelationViewSet.as_view({"post": "remove_relation"}),
)
```

### 2.3 Backend implementation ignores `relation_type`

The handler in `apps/api/plane/app/views/issue/relation.py` (lines 261–284) reads:

```python
def remove_relation(self, request, slug, project_id, issue_id):
    related_issue = request.data.get("related_issue", None)
    # NOTE: relation_type is never read from request.data

    issue_relations = IssueRelation.objects.filter(
        workspace__slug=slug,
    ).filter(
        Q(issue_id=related_issue, related_issue_id=issue_id)
        | Q(issue_id=issue_id, related_issue_id=related_issue)
    )
    issue_relations = issue_relations.first()   # ← picks ONE record
    issue_relations.delete()                    # ← deletes only that one
    return Response(status=status.HTTP_204_NO_CONTENT)
```

**Even the Plane web app's own `IssueRelationService` sends `relation_type` in its request body, but the backend completely ignores it.**

### 2.4 Delete scope: exactly one record, indeterminate when multiple exist

- `.filter(...)` returns all `IssueRelation` rows between the pair (both directions)
- `.first()` returns one row (default ordering — typically insertion order / `id`)
- Only that row is deleted

**When a pair has two relation types** (e.g., `blocked_by` row and `relates_to` row), the backend deletes whichever `.first()` returns. This is **non-deterministic from the caller's perspective**.

### 2.5 Context7 docs show a different signature

Context7's SDK reference shows:

```typescript
await client.workItems.relations.delete('ws', 'project', 'item', {
  related_list: ['related-id'],
  relation_type: 'blocked_by',
})
```

This does **not** match the published TypeScript type (`WorkItemRelationRemoveRequest`) or the backend implementation. It reflects either a planned future API or documentation error. Do not rely on it.

---

## 3. Relation Inverse Behavior

Each relation is stored as a **single DB record**. Plane maps the directional keyword:

| Creator passes                | Stored as DB record                                        |
| ----------------------------- | ---------------------------------------------------------- |
| `blocking` (A blocks B)       | `issue_id=B, related_issue_id=A, relation_type=blocked_by` |
| `blocked_by` (A blocked by B) | `issue_id=A, related_issue_id=B, relation_type=blocked_by` |
| `relates_to`                  | `issue_id=A, related_issue_id=B, relation_type=relates_to` |
| `duplicate`                   | `issue_id=A, related_issue_id=B, relation_type=duplicate`  |

The list view constructs both `blocking` and `blocked_by` from the same `blocked_by` record by querying in both directions. There is **no** separate "inverse record."

**Consequence**: deleting the single `blocked_by` record removes both the A→B `blocking` view and the B→A `blocked_by` view simultaneously. You do not need a separate call for the inverse direction.

**When multiple types exist** between the same pair, they occupy separate DB rows. Deleting one row removes only that type; the other type persists.

---

## 4. Alternative Solutions

### Option A — Pre-fetch, delete all, recreate survivors (most correct)

1. Call `relations.list(ws, project, workItemId)` to get all current types
2. Identify which entries involve `relatedIssueId`
3. Delete ALL relations—call `remove-relation` until the pair has none\*
4. Recreate all types except the target one using `relations.create`

\*Because the backend deletes only one record per call, this requires one call per relation type found.

|          |                                                                                                                                                                      |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pros** | Correctly removes exactly the target type; preserves others                                                                                                          |
| **Cons** | 2–(N+K) round-trips (list + N deletes + K recreates); non-atomic: crash mid-sequence leaves state corrupted; requires knowing the `delete` endpoint works (see §2.1) |

### Option B — Bypass SDK, call the internal app API with `relation_type`

Use the working internal endpoint directly via `fetch` or Axios:

```
POST /api/workspaces/{ws}/projects/{project}/issues/{id}/remove-relation/
{ "related_issue": "...", "relation_type": "blocked_by" }
```

Even though the backend ignores `relation_type` today, this endpoint is what the Plane UI uses. Future backend versions may start respecting the field (the web app already sends it, which strongly suggests intent to use it eventually).

|          |                                                                                                                                                           |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pros** | One round-trip; mirrors what the Plane UI does; survives future fixes automatically                                                                       |
| **Cons** | Uses undocumented internal URL, not the v1 REST API; `relation_type` still ignored; **same ambiguity problem as the SDK today**; bypasses SDK type safety |

### Option C — Accept current behavior: prohibit multi-type pairs

Document that the implementation does not support more than one relation type between the same two work items. Enforce this at the application layer:

1. Before creating a new relation: check existing relations between the pair
2. If any relation already exists between the pair, return an error (or replace the existing one)
3. `removeIssueRelation` then always removes the only existing relation

|          |                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------- |
| **Pros** | Zero ambiguity; simplest implementation; matches most real-world usage (rare to block AND relate the same pair) |
| **Cons** | Differs from Linear behavior (Linear allows multiple types); error UX if user adds a second type                |

### Option D — Wait for v1 API and type-aware delete

Track [GitHub issue #6236](https://github.com/makeplane/plane/issues/6236). Once the v1 relations endpoint exists and the backend is updated to filter by `relation_type`, update the implementation to pass the type.

|          |                                           |
| -------- | ----------------------------------------- |
| **Pros** | Clean, permanent fix                      |
| **Cons** | No ETA; cannot block implementation today |

---

## 5. Recommended Approach

**Use Option C (prohibit multi-type pairs) for now, with a path to Option D.**

Rationale:

1. **The v1 API doesn't exist yet.** Options A and B both depend on endpoints that are either missing (v1) or undocumented (app API).
2. **Option A is dangerously non-atomic.** A mid-sequence failure silently drops relations permanently.
3. **Multi-type pairs between the same two work items are rare in practice.** Linear itself limits the useful combinations: a pair being both `blocks` and `related` is unusual; `blocks` and `duplicate` is conceptually contradictory.
4. **Enforcing single-type pairs is honest to the current API's capabilities** and avoids surprising data loss.

When [#6236](https://github.com/makeplane/plane/issues/6236) ships a type-aware v1 delete endpoint, update `relations.delete` to pass `relation_type` and remove the single-type constraint.

---

## 6. Implementation Sketch

```typescript
// Type map: Linear → Plane
const relationTypeMap: Record<LinearRelationType, PlaneRelationType> = {
  blocks: 'blocking',
  duplicate: 'duplicate',
  related: 'relates_to',
}

async function removeIssueRelation(params: {
  planeClient: PlaneClient
  workspaceSlug: string
  projectId: string
  workItemId: string
  relatedWorkItemId: string
  type: LinearRelationType
}): Promise<void> {
  const { planeClient, workspaceSlug, projectId, workItemId, relatedWorkItemId, type } = params

  // Guard: verify that only the requested type exists between this pair
  // (enforces Option C — single-type constraint)
  const relations = await planeClient.workItems.relations.list(workspaceSlug, projectId, workItemId)
  const planeType = relationTypeMap[type]
  const inverseType = INVERSE_RELATION[planeType] // e.g. 'blocking' → 'blocked_by'

  const targetType = relations[planeType]?.includes(relatedWorkItemId)
    ? planeType
    : relations[inverseType]?.includes(relatedWorkItemId)
      ? inverseType
      : null

  if (targetType === null) {
    // Relation doesn't exist — treat as successful no-op or throw
    return
  }

  // Check no OTHER type exists between this pair
  const allTypesForPair = PLANE_RELATION_TYPES.filter((t) => relations[t]?.includes(relatedWorkItemId))
  const otherTypes = allTypesForPair.filter((t) => t !== targetType)
  if (otherTypes.length > 0) {
    throw new ConflictError(
      `Cannot remove '${type}' relation: work items also have [${otherTypes.join(', ')}] ` +
        `between them. Plane does not support type-specific removal when multiple ` +
        `relation types exist between the same pair.`,
    )
  }

  // Safe to delete: only one type between pair
  // NOTE: uses app-internal endpoint until v1 API ships (#6236)
  await fetch(
    `${baseUrl}/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${workItemId}/remove-relation/`,
    {
      method: 'POST',
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ related_issue: relatedWorkItemId }),
    },
  )
}
```

> **Note**: The SDK's `workItems.relations.delete` cannot be used yet (calls a 404 endpoint). Switch to it once [#6236](https://github.com/makeplane/plane/issues/6236) is resolved.

---

## 7. Limitation Documentation

The following constraints must be documented for consumers of this implementation:

| Constraint                                                                                              | Reason                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Only one relation type is permitted between any two work items                                          | Plane's `remove-relation` backend ignores `relation_type`; `.first()` deletes an arbitrary row when multiples exist                                           |
| The v1 SDK `relations.delete` method returns 404                                                        | The `/api/v1/.../work-items/.../relations/remove/` endpoint does not exist; tracked in [makeplane/plane#6236](https://github.com/makeplane/plane/issues/6236) |
| Calls use the internal app API (`/api/workspaces/.../issues/.../remove-relation/`), not the v1 REST API | Only working delete path; may break on major Plane version upgrades                                                                                           |
| `removeIssueRelation` throws `ConflictError` if a second relation type exists between the pair          | This is unavoidable until the backend supports type-filtered deletion                                                                                         |
| Verify endpoint availability during integration testing                                                 | The internal endpoint requires Plane ≥ 0.13; behaviour may differ on self-hosted instances with custom patches                                                |

---

## References

| Source                                                                 | Key finding                                                                                  |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `apps/api/plane/app/views/issue/relation.py:261–284`                   | Backend `remove_relation` uses `.first()`, ignores `relation_type`                           |
| `apps/api/plane/app/urls/issue.py:239–243`                             | Working endpoint route: `POST .../issues/{id}/remove-relation/`                              |
| `apps/web/core/services/issue/issue_relation.service.ts:40–52`         | Web app sends `relation_type` but backend ignores it                                         |
| `src/api/WorkItems/Relations.ts` (plane-node-sdk)                      | SDK calls `/api/v1/.../work-items/{id}/relations/remove/` → 404                              |
| `src/models/WorkItemRelation.ts` (plane-node-sdk)                      | `WorkItemRelationRemoveRequest` has only `related_issue: string`                             |
| [makeplane/plane#6236](https://github.com/makeplane/plane/issues/6236) | v1 relations API is missing; open feature request since Dec 2024                             |
| Context7 `/makeplane/plane-node-sdk`                                   | Docs show `related_list + relation_type` — inconsistent with published types; do not rely on |
