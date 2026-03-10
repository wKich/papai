# `get-issue` Relations Mapping: Alternative Solutions

**Date**: March 10, 2026
**Severity**: Medium (format mismatch requiring design decisions)
**Sources**: Plane Node SDK v0.2.8+ source, developers.plane.so, makeplane/plane-node-sdk GitHub

---

## 1. Problem Summary

When mapping `getIssue` from Linear to Plane, the `relations` field exposes three distinct structural gaps.

### Gap 1 — No Relation Record ID

Linear returns relations as first-class records with their own IDs:

```typescript
relations: {
  id: string // relation record ID
  type: string // 'blocks' | 'duplicate' | 'related'
  relatedIssueId: string
  relatedIdentifier: string
}
;[]
```

The `id` field is the ID of the **relation record itself** — not the related issue. It is required to update or delete a specific relation via `update_issue_relation` and `remove_issue_relation`.

Plane's `relations.list()` returns:

```typescript
// WorkItemRelationResponse
{
  blocking: string[]    // arrays of related work item UUIDs only
  blocked_by: string[]
  duplicate: string[]
  relates_to: string[]
  start_after: string[]
  start_before: string[]
  finish_after: string[]
  finish_before: string[]
}
```

There is no relation record ID in the list response.

**Note on `WorkItemRelation` model**: The SDK exports a `WorkItemRelation` interface (file: `src/models/WorkItemRelation.ts`) with an `id?: string` field alongside `sequence_id`, `name`, `relation_type`. This model is not returned by `relations.list()`. It appears to represent an internal backend record (possibly accessible via an undocumented `/relations/{id}/` endpoint) that has no SDK method exposing it. The authoritative list response type is `WorkItemRelationResponse`.

### Gap 2 — No `relatedIdentifier`

The `relatedIdentifier` (e.g., `"ENG-42"`) is Linear's human-readable identifier for the related issue. In Plane it must be reconstructed as `{project.identifier}-{workItem.sequence_id}`.

The `WorkItemRelationResponse` contains only UUID arrays. Getting the identifier requires a separate API call per related item or a pre-fetch batch. There is no built-in way to expand relation targets.

### Gap 3 — Symmetric `blocking`/`blocked_by` Duplication

Plane exposes both directions of a blocking relation simultaneously:

- If A blocks B: A's response has `blocking: ['B_uuid']` and B's response has `blocked_by: ['A_uuid']`

Linear only exposes the outgoing direction. Callers retrieving issue B in Plane must decide whether to include `blocked_by` as a separate relation type or omit it.

---

## 2. API Verification

### Confirmed: `relations.list()` Returns Plain UUID Strings

From the SDK source (`src/api/WorkItems/Relations.ts`):

```typescript
async list(
  workspaceSlug: string,
  projectId: string,
  workItemId: string,
): Promise<WorkItemRelationResponse> {
  return this.get<WorkItemRelationResponse>(
    `/workspaces/${workspaceSlug}/projects/${projectId}/work-items/${workItemId}/relations/`,
  )
}
```

From the SDK's e2e test (`tests/e2e/project.test.ts`):

```typescript
const relations = await client.workItems.relations.list(slug, project.id, workItem1.id)
expect(relations.relates_to[0]).toBe(workItem2.id) // plain UUID string
```

From the SDK's unit test (`tests/unit/work-items/relations.test.ts`):

```typescript
expect(relations.blocking).toContain(relatedWorkItemId) // confirms array of plain UUID strings
```

### Confirmed: `WorkItemRelation` Model Fields Are Not in the List Response

```typescript
// src/models/WorkItemRelation.ts
export interface WorkItemRelation {
  id?: string // NOT returned by list endpoint
  sequence_id?: number // likely the related item's sequence_id
  name?: string // likely the related item's name
  relation_type?: string
  project_id?: string
  state_id?: string
  priority?: string
  created_at?: string
  updated_at?: string
}

export interface WorkItemRelationResponse {
  blocking: string[] // confirmed: plain UUID[] from live test
  blocked_by: string[]
  duplicate: string[]
  relates_to: string[]
  start_after: string[]
  start_before: string[]
  finish_after: string[]
  finish_before: string[]
}
```

### Confirmed: `AdvancedSearchResult` Carries `project_identifier` + `sequence_id`

```typescript
// src/models/WorkItem.ts
export interface AdvancedSearchResult {
  id: string
  name: string
  sequence_id: number
  project_identifier: string // e.g. "ENG"
  project_id: string
  workspace_id: string
  type_id?: string | null
  state_id?: string | null
  priority?: string | null
  target_date?: string | null
  start_date?: string | null
}
```

Combining `project_identifier` and `sequence_id` reconstructs the human-readable identifier: `ENG-42`.

### Confirmed: `WorkItemSearchItem` Also Carries Identifier Components

```typescript
export interface WorkItemSearchItem {
  id: string
  name: string
  sequence_id: string
  project__identifier: string // Django ORM-style field name
  project_id: string
  workspace__slug: string
}
```

### Confirmed: No Batch Retrieve Endpoint by ID Array

`workItems.list()` supports filtering by `project`, `state`, and `assignee` — but not by an array of IDs. There is no documented bulk fetch by UUID list. The `AdvancedSearchFilter` type uses `[key: string]: unknown` which may support `id` as an undocumented key (see §4, Option D).

### Confirmed: `retrieveByIdentifier` Is Not Useful for Reverse Lookup

`workItems.retrieveByIdentifier(workspaceSlug, identifier)` requires an identifier string like `"ENG-42"`. Since we have UUIDs (not identifiers), this method cannot be used to resolve the direction we need.

### Confirmed: `relations.delete()` Ignores Relation Type

```typescript
export interface WorkItemRelationRemoveRequest {
  related_issue: string // no relation_type field
}
```

The delete endpoint (`/relations/remove/`) accepts only the related item ID. If two items have both a `blocking` and a `relates_to` relation, behavior when deleting is unspecified — likely removes all relations between the pair, not just a specific type.

### Note: Context7 Discrepancy in Create Request Field

Context7 documentation shows `related_list` as the field:

```typescript
// Context7 example (may be outdated)
{ related_list: ['uuid'], relation_type: 'blocked_by' }
```

The SDK interface and tests both use `issues`:

```typescript
// SDK authoritative source
export interface WorkItemRelationCreateRequest {
  relation_type: IssueRelationCreateRelationTypeEnum
  issues: string[]
}
```

Use `issues` (SDK source is authoritative over context7 examples).

---

## 3. Synthetic ID Options

Since no real relation record ID is available via the API, a synthetic ID must be generated when the caller needs to reference a relation for update or delete operations.

| Option                 | Format                                        | Stable | Reversible | Uniqueness                        | Verdict                    |
| ---------------------- | --------------------------------------------- | ------ | ---------- | --------------------------------- | -------------------------- |
| **Composite key**      | `{source}:{related}:{type}`                   | ✅     | ✅         | Unique per (source, target, type) | ✅ Recommended             |
| **Hash-based**         | `sha1({source}+{related}+{type}).slice(0,16)` | ✅     | ❌         | High, not perfect                 | 🟡 OK                      |
| **Position-based**     | `{source}-relation-{index}`                   | ❌     | ❌         | Only per-call                     | ❌ Avoid                   |
| **Accept `undefined`** | `undefined`                                   | —      | —          | No ID needed                      | 🟡 Valid if not referenced |

### Composite Key (Recommended)

```typescript
const syntheticId = `${workItemId}:${relatedItemId}:${planeRelationType}`
// e.g. "abc-123:def-456:blocking"
```

**Pros:**

- Deterministic — same inputs always yield the same ID
- Reversible — can parse back to source ID, related ID, and type
- No collision risk for distinct (source, target, type) triples
- Human-readable in logs and debug output

**Cons:**

- Not a UUID — may fail validation if downstream callers assert UUID format
- Longer string (two UUIDs + type name)

**Compatibility with `remove_issue_relation`**: The composite key maps cleanly. The delete operation needs only `related_issue`; parsing `key.split(':')[1]` gives the related UUID. No relation type is passed to the Plane delete endpoint (see §2 caveat).

### Accepting `undefined`

Return `id: undefined` for all relations. This is only safe if:

1. `update_issue_relation` and `remove_issue_relation` are implemented to work via `workItemId + relatedItemId + type` rather than by the relation's own ID, **and**
2. The LLM tools never pass the relation ID to update/remove logic

---

## 4. Identifier Resolution Options

To populate `relatedIdentifier` (e.g., `"ENG-42"`), both the `sequence_id` of the related item and the `identifier` prefix of its project are needed.

### Option A: Lazy Resolution — Return `undefined`

Return `relatedIdentifier: undefined`. Let callers resolve separately if needed.

```typescript
return {
  id: `${workItemId}:${relatedId}:blocking`,
  type: 'blocks',
  relatedIssueId: relatedId,
  relatedIdentifier: undefined,
}
```

**Pros:** Zero extra API calls; no N+1 risk  
**Cons:** LLM tools displaying or mentioning relations will show raw UUIDs instead of readable names

**When appropriate:** When the consumer (LLM) receives structured data and uses `relatedIssueId` to call `getIssue` if more detail is needed.

---

### Option B: Per-Relation `workItems.retrieve()` — N+1 Pattern

For each unique related item UUID, call `workItems.retrieve()` in parallel.

```typescript
const uniqueIds = [...new Set(allRelatedIds)]
const items = await Promise.all(uniqueIds.map((id) => client.workItems.retrieve(workspaceSlug, currentProjectId, id)))
// items[i].sequence_id + need project identifier
```

**Critical limitation:** `workItems.retrieve()` requires `projectId`. It works only when all related items are in the same project. For cross-project relations, the call may return the wrong item or fail.

**Same-project cost:** `N` parallel HTTP calls where `N` = number of unique related item UUIDs.

**Cross-project workaround:** Falls back to the `advancedSearch` approach (Option D).

---

### Option C: Project-Level List Cache

Fetch all work items in the current project once, build a `Map<uuid, identifier>`, then look up related items from the cache.

```typescript
const pages: WorkItem[] = []
let offset = 0
while (true) {
  const page = await client.workItems.list(workspaceSlug, projectId, { limit: 250, offset })
  pages.push(...page.results)
  if (!page.next_page_results) break
  offset += 250
}
const cache = new Map(pages.map((item) => [item.id, `${projectIdentifier}-${item.sequence_id}`]))
```

**Pros:** One logical operation for all same-project relations  
**Cons:**

- Only covers same-project items
- Large projects (1,000+ items) require 4+ paginated calls
- Disproportionate cost to resolve 2–3 relations
- `workItems.list()` does not support filtering by ID array

**When appropriate:** Pre-fetch cache for migration scripts or batch operations — not for on-demand `getIssue` in a chat bot.

---

### Option D: `advancedSearch` Batch Lookup (Recommended for Eager Path)

Use `advancedSearch` with an OR filter on multiple IDs to batch-resolve all related items in one call. `AdvancedSearchResult` returns `project_identifier` + `sequence_id` directly.

```typescript
const uniqueIds = [...new Set(allRelatedIds)]
if (uniqueIds.length === 0) return []

const results = await client.workItems.advancedSearch(workspaceSlug, {
  filters: {
    or: uniqueIds.map((id) => ({ id })),
  },
  limit: uniqueIds.length,
})
// AdvancedSearchResult: { id, sequence_id, project_identifier, ... }

const idToIdentifier = new Map(results.map((r) => [r.id, `${r.project_identifier}-${r.sequence_id}`]))

return relations.map((r) => ({
  ...r,
  relatedIdentifier: idToIdentifier.get(r.relatedIssueId),
}))
```

**Pros:**

- Single API call regardless of how many related items there are
- Works across projects — no `projectId` required, scoped to workspace
- Returns `project_identifier` + `sequence_id` which directly builds the identifier

**Cons:**

- **Unconfirmed**: `AdvancedSearchFilter`'s `[key: string]: unknown` allows any key, but whether the Plane backend accepts `{ id: 'uuid' }` as a filter condition is not documented. Requires verification against a live instance.

**Verification test:**

```bash
curl -X POST \
  'https://api.plane.so/api/v1/workspaces/my-workspace/work-items/search/advanced/' \
  -H 'X-API-Key: $KEY' \
  -H 'Content-Type: application/json' \
  -d '{"filters": {"or": [{"id": "some-uuid"}]}, "limit": 1}'
```

If the `id` filter is rejected, fall back to Option B (parallel per-project retrieve calls).

---

### Comparison

| Option                       | Extra API calls | Cross-project        | Confirmed API  | Complexity |
| ---------------------------- | --------------- | -------------------- | -------------- | ---------- |
| A: Lazy / `undefined`        | 0               | N/A                  | ✅             | Low        |
| B: Parallel `retrieve()`     | N (parallel)    | ❌ same-project only | ✅             | Medium     |
| C: Project list cache        | 1+ paginated    | ❌ same-project only | ✅             | High       |
| D: `advancedSearch` OR batch | 1               | ✅                   | ⚠️ Unconfirmed | Medium     |

---

## 5. Inverse Direction Handling

### Three Strategies

**Strategy 1: Include Both Directions**

Map all Plane relation keys (including `blocked_by`) to a Linear type:

| Plane key                                                      | Linear `type`                      |
| -------------------------------------------------------------- | ---------------------------------- |
| `blocking`                                                     | `'blocks'`                         |
| `blocked_by`                                                   | `'is_blocked_by'` _(non-standard)_ |
| `duplicate`                                                    | `'duplicate'`                      |
| `relates_to`                                                   | `'related'`                        |
| `start_after`, `start_before`, `finish_after`, `finish_before` | `'related'` _(collapsed)_          |

**Problem:** Linear's type union is `'blocks' | 'duplicate' | 'related'`. An `'is_blocked_by'` type does not exist in the contract. Downstream tool handlers and LLM prompts that pattern-match on `type` will receive an unexpected value.

---

**Strategy 2: Suppress `blocked_by` (Recommended)**

Only map outgoing relations; omit `blocked_by` and temporal types:

```typescript
const PLANE_TO_LINEAR_TYPE: Partial<Record<keyof WorkItemRelationResponse, LinearRelationType>> = {
  blocking: 'blocks',
  duplicate: 'duplicate',
  relates_to: 'related',
  // blocked_by — intentionally omitted (inverse direction)
  // start_after, start_before, finish_after, finish_before — no Linear equivalent
}
```

**Rationale:** This mirrors how Linear works. If B is blocked by A, `getIssue(B)` in Linear does not return "I am being blocked." The LLM can call `getIssue(A)` to discover that A blocks B. Presenting the `blocked_by` list in B's response creates a redundant/duplicate view of the same fact.

---

**Strategy 3: Remap `blocked_by` as `blocks` (Incorrect)**

Emit `blocked_by` items as `{ type: 'blocks', relatedIssueId: blocker_uuid }` from the current item's perspective.

**Problem:** This inverts cause and effect. The current item does not block its blockers. This approach silently corrupts the semantic meaning of the relation.

---

**Verdict:** Use Strategy 2. The LLM has `getIssue` available to look up any related item and discover the inverse relationship independently.

---

## 6. Recommended Approach

### Synthetic ID: Composite Key

Use `${workItemId}:${relatedItemId}:${planeRelationType}` as the synthetic relation ID.

- Deterministic and reversible across calls
- Compatible with `remove_issue_relation` (parse `[1]` for related UUID)
- No hashing, no collision risk

### Identifier Resolution: Lazy by Default, Eager Optional

Default to `relatedIdentifier: undefined` (Option A) in the `getIssue` path. The LLM receives `relatedIssueId` (UUID) which is sufficient to call `getIssue` on the related item.

If eager resolution is required (e.g., for display purposes), implement it as an opt-in behind a `resolveIdentifiers` flag using Option D (`advancedSearch` batch) once the `id` filter is confirmed.

### Inverse Direction: Suppress `blocked_by`

Emit only `blocking`, `duplicate`, and `relates_to`. Drop `blocked_by` and all temporal types (`start_after`, `start_before`, `finish_after`, `finish_before`).

---

## 7. Implementation Sketch

```typescript
// Plane → Linear relation type map (outgoing only)
type LinearRelationType = 'blocks' | 'duplicate' | 'related'

const PLANE_TO_LINEAR: Partial<Record<keyof WorkItemRelationResponse, LinearRelationType>> = {
  blocking: 'blocks',
  duplicate: 'duplicate',
  relates_to: 'related',
  // blocked_by: omitted — inverse direction
  // start_after, start_before, finish_after, finish_before: no Linear equivalent
}

interface MappedRelation {
  readonly id: string
  readonly type: LinearRelationType
  readonly relatedIssueId: string
  readonly relatedIdentifier: string | undefined
}

// Core mapping — zero extra API calls, lazy identifier
function mapPlaneRelations(workItemId: string, planeRelations: WorkItemRelationResponse): readonly MappedRelation[] {
  return Object.entries(planeRelations).flatMap(([planeType, relatedIds]) => {
    const linearType = PLANE_TO_LINEAR[planeType as keyof WorkItemRelationResponse]
    if (linearType === undefined) return []

    return (relatedIds as string[]).map((relatedId) => ({
      id: `${workItemId}:${relatedId}:${planeType}`,
      type: linearType,
      relatedIssueId: relatedId,
      relatedIdentifier: undefined,
    }))
  })
}

// Optional: resolve identifiers via advancedSearch (single batch call)
// ⚠️ Requires confirming that `id` is a valid AdvancedSearchFilter key
async function withResolvedIdentifiers(
  client: PlaneClient,
  workspaceSlug: string,
  relations: readonly MappedRelation[],
): Promise<readonly MappedRelation[]> {
  const uniqueIds = [...new Set(relations.map((r) => r.relatedIssueId))]
  if (uniqueIds.length === 0) return relations

  const results = await client.workItems.advancedSearch(workspaceSlug, {
    filters: { or: uniqueIds.map((id) => ({ id })) },
    limit: uniqueIds.length,
  })

  const idToIdentifier = new Map(results.map((r) => [r.id, `${r.project_identifier}-${r.sequence_id}`]))

  return relations.map((r) => ({
    ...r,
    relatedIdentifier: idToIdentifier.get(r.relatedIssueId),
  }))
}

// Usage in getIssue
const planeRelations = await client.workItems.relations.list(workspaceSlug, projectId, workItemId)
const relations = mapPlaneRelations(workItemId, planeRelations)
// optionally: const resolved = await withResolvedIdentifiers(client, workspaceSlug, relations)
```

### Parsing the Composite Key in `remove_issue_relation`

```typescript
function parseRelationId(syntheticId: string): { sourceId: string; relatedId: string; relationType: string } {
  const [sourceId, relatedId, relationType] = syntheticId.split(':')
  return { sourceId, relatedId, relationType }
}

// In remove_issue_relation:
const { relatedId } = parseRelationId(relationId)
await client.workItems.relations.delete(workspaceSlug, projectId, workItemId, {
  related_issue: relatedId,
})
// ⚠️ See remove-issue-relation.md: delete removes ALL relation types between the pair
```

---

## 8. Performance Notes

### N+1 Risk

The primary risk is issuing `workItems.retrieve()` per relation. For an issue with 10 blocking items, that is 10 extra HTTP calls per `getIssue` invocation — each requiring the related item's `projectId` (same-project assumption), plus potentially a project lookup for the identifier prefix.

**Mitigation:**

1. Default to lazy resolution (zero extra calls)
2. Use `advancedSearch` batch if eager — 1 call regardless of relation count
3. Cache project identifiers at the session level — a `Map<projectId, identifier>` built from `client.projects.list()` amortizes cost across many `getIssue` calls

### `advancedSearch` ID Filter: Unconfirmed

The `AdvancedSearchFilter` type is:

```typescript
export type AdvancedSearchFilter = {
  and?: AdvancedSearchFilter[]
  or?: AdvancedSearchFilter[]
  [key: string]: unknown // arbitrary leaf conditions
}
```

The `[key: string]: unknown` index signature allows passing `{ id: 'uuid' }` as a leaf condition. Whether the Plane backend's search engine supports ID-based filtering is not documented. Until confirmed:

- If ID filter works → use Option D (safest for cross-project relations)
- If ID filter is unsupported → fall back to parallel `workItems.retrieve()` for same-project relations only (Option B)

### Temporal Relation Types

Plane has four temporal types (`start_after`, `start_before`, `finish_after`, `finish_before`) with no Linear equivalent. These are silently dropped in the `PLANE_TO_LINEAR` map. If surface-level transparency is required, they can be mapped to `type: 'related'` — but this loses the temporal semantic.

### Pagination of `workItems.list()`

`workItems.list()` returns at most 250 items per page (default). A project with 500+ items requires multiple calls. This makes the project-level cache approach (Option C) unsuitable for on-demand `getIssue` calls in an interactive assistant context.

---

## Summary of Key Findings

| Finding                                                                                                     | Source                                                                         |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `relations.list()` returns only UUID arrays — no relation record IDs                                        | SDK `WorkItemRelationResponse`, e2e + unit tests                               |
| `WorkItemRelation` model has `id?: string` but is **not** returned by `list()`                              | `src/models/WorkItemRelation.ts`                                               |
| Context7 uses `related_list`; SDK uses `issues` in `WorkItemRelationCreateRequest`                          | SDK source is authoritative                                                    |
| `AdvancedSearchResult` includes `project_identifier` + `sequence_id` for identifier reconstruction          | `src/models/WorkItem.ts`                                                       |
| No confirmed batch-by-ID fetch endpoint; `advancedSearch` OR filter on `id` is unverified                   | API docs, SDK types                                                            |
| `relations.delete()` takes only `related_issue` (no `relation_type`) — removes all relations between a pair | `WorkItemRelationRemoveRequest`, conflicts with `remove_issue_relation` design |
| Composite key `${source}:${related}:${type}` is a deterministic, reversible synthetic ID                    | Analysis                                                                       |
| `blocked_by` has no Linear equivalent and should be omitted from `getIssue` output                          | Semantic analysis                                                              |
| Temporal relation types (`start_*`, `finish_*`) have no Linear equivalent and should be dropped             | API comparison                                                                 |
