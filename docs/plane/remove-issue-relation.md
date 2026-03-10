# Mapping: `removeIssueRelation` → Plane SDK

## Linear Implementation

**File**: `src/linear/remove-issue-relation.ts`

```typescript
removeIssueRelation({ apiKey, issueId, relatedIssueId }):
  Promise<{ id: string; success: true }>
```

**Linear SDK call**:

```typescript
const client = new LinearClient({ apiKey })
const issue = await client.issue(issueId)
// finds relation by relatedIssueId using relation-helpers
const foundRelation = await findRelationByRelatedIssueId({ issue, relatedIssueId })
await client.deleteIssueRelation(foundRelation.id)
// returns { id: foundRelation.id, success: true }
```

---

## Plane SDK Equivalent

**SDK method**: ~~`client.workItems.relations.delete`~~ — **not usable today**

The v1 SDK method calls `POST /api/v1/.../work-items/{id}/relations/remove/` which returns 404 on all current Plane installs. Tracked in [makeplane/plane#6236](https://github.com/makeplane/plane/issues/6236). The internal app endpoint is used instead (see §Implementation Decision below).

---

## Key Differences

| Aspect         | Linear                                                  | Plane                                                                        |
| -------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Identification | Relation has own `id`; must look up by `relatedIssueId` | Delete directly by `(workItemId, relatedWorkItemId)` — no relation ID needed |
| Lookup step    | Must find relation object by scanning relations         | Direct delete by pair — no pre-fetch needed                                  |
| Return value   | `{ id, success: true }`                                 | `void`                                                                       |
| Scope          | Global by relation ID                                   | `workspaceSlug` + `projectId` + `workItemId` + `relatedIssueId`              |
| Type-specific  | Not required — finds any relation between the pair      | Not required — delete is unambiguous (see §Implementation Decision)          |

---

## Implementation Decision: Option C (single-type pairs)

See [conflicts/remove-issue-relation.md](conflicts/remove-issue-relation.md) for the full analysis. **Option C is used.**

Plane's DB unique constraint is on `(issue, related_issue)` only — `relation_type` is not part of it. This means a pair can hold **at most one relation type** at a time (Plane silently no-ops duplicate `create` calls; see `add-issue-relation.md`). The multi-type ambiguity described in the conflict doc therefore **cannot arise in practice**: the structural guarantee is Plane's own DB constraint, not a manual application guard.

The `type` parameter is accepted but used only for logging and forward compatibility. The delete targets the pair `(workItemId, relatedWorkItemId)`, which is always unambiguous.

The v1 SDK endpoint (`workItems.relations.delete`) returns 404 (tracked in [makeplane/plane#6236](https://github.com/makeplane/plane/issues/6236)). The implementation uses the internal app endpoint until the v1 API ships.

---

## Plane Implementation

```typescript
export async function removeIssueRelation({
  apiKey,
  baseUrl,
  workspaceSlug,
  projectId,
  issueId,
  relatedIssueId,
  type, // accepted for logging; delete is by pair — always unambiguous
}: {
  apiKey: string
  baseUrl: string
  workspaceSlug: string
  projectId: string
  issueId: string
  relatedIssueId: string
  type: 'blocks' | 'duplicate' | 'related'
}): Promise<{ id: string; success: true }> {
  // NOTE: SDK v1 workItems.relations.delete returns 404 until makeplane/plane#6236 ships.
  // Use the internal app endpoint that the Plane web UI calls.
  const url = `${baseUrl}/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/remove-relation/`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ related_issue: relatedIssueId }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`removeIssueRelation failed (${response.status}): ${text}`)
  }

  // Plane returns 204 No Content; return a shape consistent with the Linear interface.
  return { id: issueId, success: true }
}
```

---

## Migration Notes

- No pre-fetch needed: Plane deletes by pair, not by relation ID.
- `type` param is not sent to Plane today (backend ignores it). Keep it in the interface so a future switch to the v1 API (once `#6236` ships) requires no interface changes.
- Plane enforces one-relation-per-pair at DB level, so the delete is always unambiguous.
- Linear's `findRelationByRelatedIssueId` helper is not needed in Plane.
- Return `{ id: issueId, success: true }` to stay interface-compatible with the Linear implementation.
- Switch `fetch` call to `client.workItems.relations.delete(...)` once [makeplane/plane#6236](https://github.com/makeplane/plane/issues/6236) is resolved and the backend accepts `relation_type`.
