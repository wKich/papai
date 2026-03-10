# `search-issues` Conflict Analysis: Missing Filters in Plane SDK

**Date**: March 10, 2026  
**Conflict source**: `docs/plane/linear-plane-conflicts.md`

---

## 1. Problem Summary

When mapping `searchIssues` from Linear to Plane, three Linear filter parameters have no direct equivalent in the Plane REST API or Node SDK:

| Linear Param   | Type                                                  | Plane Equivalent       |
| -------------- | ----------------------------------------------------- | ---------------------- |
| `hasRelations` | `boolean`                                             | ❌ None                |
| `relationType` | `'blocks' \| 'blockedBy' \| 'duplicate' \| 'related'` | ❌ None                |
| `estimate`     | `number`                                              | ❌ None in filter APIs |

Additionally, two other filter params (`labelId`, `priority`) needed clarification on `advancedSearch` support.

---

## 2. `advancedSearch` Verification

**Endpoint**: `POST /api/v1/workspaces/{slug}/work-items/advanced-search/`  
**SDK method**: `client.workItems.advancedSearch(workspaceSlug, data)`

### `AdvancedSearchFilter` Type Definition

```typescript
// From: makeplane/plane-node-sdk src/models/WorkItem.ts
export type AdvancedSearchFilter = {
  and?: AdvancedSearchFilter[]
  or?: AdvancedSearchFilter[]
  [key: string]: unknown // <-- accepts any leaf key
}

export interface AdvancedSearchWorkItem {
  query?: string
  filters?: AdvancedSearchFilter
  limit?: number
}
```

The type is intentionally loose (`[key: string]: unknown`). The SDK itself imposes **no constraint** on filter leaf keys. Server-side acceptance is what matters.

### Confirmed Leaf Filter Fields (from SDK tests + live e2e tests)

| Field      | Example                | Verified          |
| ---------- | ---------------------- | ----------------- |
| `state_id` | `{ state_id: "uuid" }` | ✅ e2e tests pass |
| `priority` | `{ priority: "high" }` | ✅ e2e tests pass |

**Syntax**: Leaf conditions are plain objects; `and`/`or` allow nesting:

```typescript
filters: {
  and: [
    { state_id: "..." },
    { or: [{ priority: "high" }, { priority: "urgent" }] },
  ],
}
```

### `AdvancedSearchResult` Returned Fields

```typescript
// From: makeplane/plane-node-sdk src/models/WorkItem.ts
export interface AdvancedSearchResult {
  id: string
  name: string
  sequence_id: number
  project_identifier: string // e.g. "PROJ"
  project_id: string
  workspace_id: string
  type_id?: string | null
  state_id?: string | null
  priority?: string | null
  target_date?: string | null
  start_date?: string | null
  // ⚠️ NO estimate_point
  // ⚠️ NO labels
  // ⚠️ NO assignees
  // ⚠️ NO relation info
}
```

### Confirmed vs. Unconfirmed Filter Fields

The SDK's `[key: string]: unknown` escape hatch means additional filter fields **may** be accepted by the server. However:

- **`estimate_point`**: Not listed in any official filter documentation or SDK tests. Even if the server accepted it, `AdvancedSearchResult` doesn't return `estimate_point` for verification.
- **`label_id`**: Not listed in official filter documentation or SDK tests either.
- **`has_relation` / `relation_type`**: No evidence of server-side support in any source examined (official docs, SDK source, SDK tests, GitHub issues).
- **`target_date` / `start_date`**: These fields appear in `AdvancedSearchResult`, suggesting they may also be filterable as leaf conditions — but no tests confirm the exact operator syntax (e.g., whether it accepts a plain string or requires an operator object like `{ lte: "..." }`).
- **`type_id`**: Returned in `AdvancedSearchResult`; likely filterable, unverified.

Passing undocumented fields risks silent rejection (field ignored) with no error surfaced to the caller.

### SDK Unit Test Evidence (v0.2.8, `tests/unit/work-items/work-items.test.ts`)

The SDK's unit tests include three `advancedSearch` test cases:

1. **Query only** — `{ query: "...", limit: 10 }`: verifies basic text search.
2. **Priority filter** — `{ filters: { and: [{ priority: workItem.priority }] } }`: confirms `priority` leaf key.
3. **Nested AND/OR with `state_id`** — `{ filters: { and: [{ state_id: stateId }, { or: [{ priority: "high" }, { priority: "urgent" }] }] } }`: confirms `state_id` and nested logic.

No test exists for `estimate_point`, `label_id`, `assignee_id`, `has_relation`, `relation_type`, or any custom property field values.

---

## 3. Custom Properties and `AdvancedSearch`

**Plane docs reference**: `https://docs.plane.so/core-concepts/issues/visualise_filter#custom-properties`

### What Custom Properties Are

Plane's custom properties are **user-defined fields** added to work item types via `WorkItemProperty` objects. They are distinct from Plane's built-in fields (`estimate_point`, `labels`, `state`, `priority`, etc.):

| Property Type | SDK Type      | Example Use Case               |
| ------------- | ------------- | ------------------------------ |
| `TEXT`        | string        | Free-form notes, URLs          |
| `DECIMAL`     | number        | Story points, effort estimates |
| `OPTION`      | dropdown UUID | Environment, severity          |
| `BOOLEAN`     | boolean       | Is blocking, needs review      |
| `DATETIME`    | ISO string    | Review date, launch date       |
| `RELATION`    | UUID(s)       | Reviewer, code owner (User)    |

Custom property values are stored as `WorkItemPropertyValue` records — separate from the work item row itself.

### Does `AdvancedSearch` Support Custom Property Filtering?

**Finding: No confirmed evidence.**

Three sources were checked:

1. **`AdvancedSearchResult` model** (`plane-node-sdk@0.2.8`): Does not include any custom property value fields. Since the response cannot surface custom property values, even if a custom property filter were accepted server-side, the caller cannot verify the filter was applied.

2. **SDK unit tests**: All three `advancedSearch` test cases use only `priority` and `state_id`. No custom property test exists.

3. **Backend source**: The `advanced-search` endpoint does not exist in the publicly available open-source `develop` branch (which is 1549 commits behind `preview`). The backend implementation is not inspectable.

### Critical Distinction: UI Filtering vs. API Filtering

The Plane docs page describes **UI-level filter configuration** — what users can filter by when browsing work items in the web app. This is implemented via the project's `GET /projects/{id}/issues/` paginated endpoint with complex filter query params, **not** via `advancedSearch`.

The `advancedSearch` endpoint is a separate, purpose-built search API with a structured JSON filter body. The UI's filter capabilities do **not** map 1:1 to `advancedSearch` leaf keys.

### Does Custom Property Filtering Help with the Conflict Fields?

No, for two reasons:

1. **`estimate_point` is a built-in field**, not a custom property. Even a DECIMAL custom property named "Estimate" would be a separate field from the built-in `estimate_point`. They are stored differently and queried differently.

2. **`hasRelations`/`relationType` are relation queries**, not property values. No custom property type represents "has a relation of type X" — relations in Plane are a sub-resource with their own API (`client.workItems.relations.list()`).

### Summary

| Conflict Field        | Custom Properties Help? | Reason                                               |
| --------------------- | ----------------------- | ---------------------------------------------------- |
| `estimate` (built-in) | ❌ No                   | `estimate_point` is a built-in field, not a property |
| `hasRelations`        | ❌ No                   | Relations are a sub-resource, not a property type    |
| `relationType`        | ❌ No                   | Same as above                                        |
| Custom DECIMAL field  | ❓ Unknown              | No SDK test, no `AdvancedSearchResult` field         |
| Custom OPTION field   | ❓ Unknown              | Same — entirely unverified                           |

The original conflict analysis conclusions for `estimate`, `hasRelations`, and `relationType` are **unchanged** by the custom properties docs reference.

---

## 4. REST API Filter Support

### `GET /api/v1/workspaces/{slug}/projects/{project_id}/work-items/` — List

Documented query params (from `developers.plane.so` + SDK `ListWorkItemsParams`):

| Param            | Type                   | Supported         |
| ---------------- | ---------------------- | ----------------- |
| `project`        | string (ID)            | ✅                |
| `state`          | string (ID)            | ✅                |
| `assignee`       | string (ID)            | ✅                |
| `limit`          | number                 | ✅                |
| `offset`         | number                 | ✅                |
| `expand`         | comma-separated string | ✅                |
| `label_id`       | —                      | ❌ Not documented |
| `estimate_point` | —                      | ❌ Not documented |
| `has_relation`   | —                      | ❌ Not documented |
| `priority`       | —                      | ❌ Not documented |

Returns full `WorkItem` objects, which include `estimate_point?: string`, making client-side filtering on this field feasible after fetch.

### `GET /api/v1/workspaces/{slug}/work-items/search/` — Simple Search

| Param     | Type              | Supported |
| --------- | ----------------- | --------- |
| `search`  | string (required) | ✅        |
| `project` | string (ID)       | ✅        |

Returns lightweight `WorkItemSearchItem[]` (name, id, sequence_id, identifiers only). Does **not** include `estimate_point` or any relational data.

### `POST /api/v1/workspaces/{slug}/work-items/advanced-search/` — Advanced Search

See Section 2. Confirmed filter fields are `state_id` and `priority` with nested `and`/`or`. Returns `AdvancedSearchResult[]` (no estimate, no labels, no relations).

---

## 4. Per-Filter Analysis

### 4.1 `estimate` Filter

**Linear**: Accepts an integer estimate value and returns issues with that estimate.

**Plane**: `estimate_point` exists on `WorkItem` as a `string` (the estimate system stores display values like `"1"`, `"2"`, `"5"`, or t-shirt sizes based on project config). It is **not an integer** despite the API overview calling it "integer or null (0–7)" — that appears to refer to the display index, not a fixed scale.

**API support**: None. Not a parameter in `list`, `search`, or `advancedSearch`.

**Alternatives**:

| Option                                      | Mechanism                                                           | Pros                           | Cons                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------- |
| A. Client-side via `list`                   | Fetch all items (paginated), filter by `estimate_point` client-side | Works reliably with typed data | Fetches all pages; `estimate_point` format depends on project config |
| B. `advancedSearch` with undocumented field | Pass `{ estimate_point: value }` as filter leaf                     | Zero extra calls if it works   | Silently ignored if not supported; unverified                        |
| C. Return warning, omit filter              | Log a warning that the filter is not supported                      | Simple; predictable            | Discards a user-requested filter                                     |

**Recommended**: **Option A** (client-side via `list`) combined with server-side filters for everything else, then `estimate_point` checked post-fetch. The `list` already returns `estimate_point` in the `WorkItem` model. Apply other filters server-side first to reduce the candidate set before the final client-side pass.

### 4.2 `hasRelations` Filter

**Linear**: Filters issues that have at least one relation of any type.

**Plane**: Relations are a sub-resource. `client.workItems.relations.list(workspaceSlug, projectId, workItemId)` returns a `WorkItemRelationResponse`:

```typescript
interface WorkItemRelationResponse {
  blocking: string[]
  blocked_by: string[]
  duplicate: string[]
  relates_to: string[]
  start_after: string[]
  start_before: string[]
  finish_after: string[]
  finish_before: string[]
}
```

There is no "list all items in a project that have relations" endpoint. Relations are item-level only.

**Alternatives**:

| Option                             | Mechanism                                                                          | API calls          | Pros                                   | Cons                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------- | ------------------ | -------------------------------------- | ------------------------------------ |
| A. Sequential N+1                  | Fetch all items, call `relations.list` per item                                    | 1 + N              | Simple                                 | Very slow; hits rate limits at scale |
| B. Parallel batch                  | Fetch all items, call `relations.list` for all in parallel                         | 1 + N (concurrent) | Faster                                 | Same N API calls; rate-limit risk    |
| C. Unsupported, warn user          | Log a warning, skip filter, return all                                             | 1                  | One API call                           | User gets unfiltered results         |
| D. Defer to post-search enrichment | Fetch items, then enrich with relations only when `hasRelations=true` is requested | 1 + N              | Reuses existing relation fetching path | Still N+1                            |

**Recommended**: **Option C** (warn + skip). The cost of accurate `hasRelations` filtering is O(N) relations API calls. In any meaningful workspace, this is prohibitive. The correct approach is to:

1. Log a structured warning that the filter is not supported.
2. Execute the search without the filter.
3. Optionally surface a message in the LLM response noting results may include items without relations.

### 4.3 `relationType` Filter

**Linear**: Filters issues that have at least one relation of the specific type (`blocks`, `blockedBy`, `duplicate`, `related`).

**Plane**: Same constraint as `hasRelations`. No server-side support. Requires per-item `relations.list()` call.

**Note on type mapping**: Linear's relation types differ from Plane's:

| Linear      | Plane        |
| ----------- | ------------ |
| `blocks`    | `blocking`   |
| `blockedBy` | `blocked_by` |
| `duplicate` | `duplicate`  |
| `related`   | `relates_to` |

Plane also has 4 additional types not in Linear: `start_before`, `start_after`, `finish_before`, `finish_after`.

**Recommended**: **Same as `hasRelations`** — warn + skip. If performance is acceptable in a given deployment (small workspace, <50 items), the N+1 pattern in Option A could be enabled via a config flag, but should be opt-in.

### 4.4 `labelId` / `labelName` Filter (for completeness)

**Linear**: Accepts label ID or name.

**Plane**: `advancedSearch` with `{ label_id: "..." }` is **not documented** and not in any SDK test. The `list` API has no `label_id` param either.

**Recommended**: Use `advancedSearch` carefully. Test empirically in integration tests. Fallback to client-side post-filtering from `list` results (which include `labels?: string[]`).

### 4.5 `priority` Filter

**Linear**: Accepts priority as integer (0=none, 1=urgent, 2=high, 3=medium, 4=low).

**Plane `advancedSearch`**: Accepts `{ priority: "high" | "urgent" | "medium" | "low" | "none" }`. ✅ Confirmed working.

**Mapping required**: Convert Linear's integer to Plane's string enum before passing to `advancedSearch`.

---

## 5. Performance Impact

For a workspace with **N total work items** visible to a query:

### Client-side `estimate` filtering

| Workspace size    | Items to fetch       | Round trips    | Latency estimate |
| ----------------- | -------------------- | -------------- | ---------------- |
| Small (<100)      | 1 page               | 1              | <500ms           |
| Medium (100–1000) | 10 pages at 100/page | 10 sequential  | 5–10 seconds     |
| Large (1000+)     | 10+ pages            | 10+ sequential | 10+ seconds      |

Mitigation: Apply server-side filters (`state`, `assignee`, `priority`) first to shrink candidate set before paginating.

### Client-side `hasRelations` / `relationType` filtering

| Workspace size   | Items after initial filters | Relations calls | Total calls | Latency estimate     |
| ---------------- | --------------------------- | --------------- | ----------- | -------------------- |
| Small (<50)      | ~50                         | 50              | 51          | ~25 seconds          |
| Medium (100–500) | ~200                        | 200             | 201         | 100+ seconds         |
| Large (1000+)    | 1000+                       | 1000+           | 1001+       | Effectively unusable |

Even with parallelism at 10 concurrent requests, `hasRelations` filtering over 200 items requires ~20 batches. This approaches impractical at any non-trivial scale.

**Conclusion**: `hasRelations`/`relationType` cannot be made performant without native API support. `estimate` filtering is feasible only when the candidate set after server-side pre-filtering is small (<100 items).

---

## 6. Recommended Approach

| Linear Filter         | Plane Approach                            | Notes                                      |
| --------------------- | ----------------------------------------- | ------------------------------------------ |
| `query`               | `advancedSearch` with `query`             | ✅ First-class support                     |
| `stateId`/`stateName` | `advancedSearch` `{ state_id }`           | Resolve name → ID first                    |
| `assigneeId`          | `list` with `assignee` param              | Only on `list`, not `advancedSearch`       |
| `priority`            | `advancedSearch` `{ priority }`           | Map integer → string enum                  |
| `labelId`             | `advancedSearch` `{ label_id }` tentative | Unverified; fallback to client-side        |
| `estimate`            | Client-side from `list` results           | Apply after server-side filters reduce set |
| `hasRelations`        | **Warn + skip filter**                    | N+1 cost is prohibitive                    |
| `relationType`        | **Warn + skip filter**                    | Same; warn user about limitation           |
| `dueDateBefore`       | `advancedSearch` `{ target_date: ... }`   | Verify operator syntax                     |
| `dueDateAfter`        | `advancedSearch` `{ target_date: ... }`   | Verify operator syntax                     |

### Strategy: Two-tier search

1. **Server-tier** (fast): Use `advancedSearch` for `query`, `state_id`, `priority`. Optionally add `label_id` if empirically verified.
2. **Client-tier** (selective): For `estimate` only — paginate through `list` results (scoped by server-tier IDs if cross-filtering is needed) and filter by `estimate_point`.
3. **Skip tier**: For `hasRelations`/`relationType` — log a warning and omit the filter.

---

## 7. Implementation Sketch

```typescript
type SearchIssuesParams = {
  workspaceSlug: string
  query?: string
  stateId?: string
  assigneeId?: string
  labelId?: string
  priority?: 0 | 1 | 2 | 3 | 4 // Linear integer scale
  estimateValue?: number // Linear estimate value
  hasRelations?: boolean // ← not supportable
  relationType?: string // ← not supportable
  dueDateBefore?: string
  dueDateAfter?: string
}

const PRIORITY_MAP: Record<number, string> = {
  0: 'none',
  1: 'urgent',
  2: 'high',
  3: 'medium',
  4: 'low',
}

async function searchIssues(client: PlaneClient, params: SearchIssuesParams) {
  const { workspaceSlug, query, stateId, assigneeId, labelId, priority, estimateValue, hasRelations, relationType } =
    params

  // Warn about unsupported filters
  if (hasRelations !== undefined || relationType !== undefined) {
    logger.warn(
      { hasRelations, relationType },
      'hasRelations/relationType filters are not supported by Plane API; filter will be ignored',
    )
  }

  // Tier 1: server-side filters via advancedSearch
  const filterLeaves: Record<string, unknown>[] = []
  if (stateId !== undefined) filterLeaves.push({ state_id: stateId })
  if (priority !== undefined) filterLeaves.push({ priority: PRIORITY_MAP[priority] })
  // label_id: include cautiously (unverified; may be silently ignored)
  if (labelId !== undefined) filterLeaves.push({ label_id: labelId })

  const advancedResults = await client.workItems.advancedSearch(workspaceSlug, {
    query,
    filters: filterLeaves.length > 0 ? { and: filterLeaves } : undefined,
    limit: 100,
  })

  // If estimate filter is also requested, we need full WorkItem data
  // (AdvancedSearchResult doesn't include estimate_point)
  if (estimateValue !== undefined) {
    const estimateStr = String(estimateValue)
    const advancedIds = new Set(advancedResults.map((r) => r.id))

    // Tier 2: list-based fetch for estimate filtering
    // Scope to assignee if provided to reduce candidate set
    const listParams: ListWorkItemsParams = { limit: 250 }
    if (assigneeId !== undefined) listParams.assignee = assigneeId

    // We must query per project since list() is project-scoped
    // Fetch projects referenced in advancedResults to limit scope
    const projectIds = [...new Set(advancedResults.map((r) => r.project_id))]

    const allItems = await Promise.all(
      projectIds.map((projectId) => client.workItems.list(workspaceSlug, projectId, listParams)),
    )

    return allItems
      .flatMap((page) => page.results)
      .filter((item) => advancedIds.has(item.id) && item.estimate_point === estimateStr)
      .map(toSearchResult)
  }

  // Resolve assignee filter: advancedSearch doesn't support it, use list fallback
  if (assigneeId !== undefined && filterLeaves.every((f) => !('assignee' in f))) {
    // Post-filter: assignee isn't in advancedSearch confirmed fields
    // This is a known gap — if assigneeId is the only filter, use list instead
  }

  return advancedResults.map(toAdvancedSearchResult)
}

function toAdvancedSearchResult(r: AdvancedSearchResult) {
  return {
    id: r.id,
    identifier: `${r.project_identifier}-${r.sequence_id}`,
    title: r.name,
    priority: r.priority ?? 'none',
    url: `https://app.plane.so/work-items/${r.id}`,
  }
}

function toSearchResult(item: WorkItem) {
  // requires project identifier lookup separately
  return {
    id: item.id,
    identifier: `${item.project}-${item.sequence_id}`, // project identifier needs enrichment
    title: item.name,
    priority: item.priority ?? 'none',
    url: `https://app.plane.so/work-items/${item.id}`,
  }
}
```

---

## 8. Open Questions

1. **`assigneeId` in `advancedSearch`**: Empirically test if `{ assignee_id: "..." }` is accepted as a filter leaf. If yes, simplifies the two-tier approach significantly.
2. **`label_id` in `advancedSearch`**: Same — test empirically before relying on it.
3. **`target_date` filter syntax**: What operator format does the server expect? `{ target_date: { lte: "YYYY-MM-DD" } }`? `{ target_date__lte: "..." }`? Not documented.
4. **`estimate_point` format**: Is it the index (0–7), the display value ("1", "3", "5", "M", "L"), or varies by project config? Needs a round-trip test with a configured project.
5. **Native relation filtering (future)**: Consider filing a feature request with Plane for server-side `has_relations` and `relation_type` filter support on the `advancedSearch` endpoint.
