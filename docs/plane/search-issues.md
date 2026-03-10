# Mapping: `searchIssues` → Plane SDK

## Linear Implementation

**File**: `src/linear/search-issues.ts`

```typescript
type SearchIssuesParams = {
  apiKey: string
  query?: string
  state?: string           // workflow state name (string, not ID)
  projectId?: string       // Linear project filter
  labelName?: string       // filter by label name
  labelId?: string         // filter by label ID
  dueDateBefore?: string   // ISO date
  dueDateAfter?: string    // ISO date
  estimate?: number
  hasRelations?: boolean
  relationType?: 'blocks' | 'blockedBy' | 'duplicate' | 'related'
}

searchIssues(params): Promise<{ id: string; identifier: string; title: string; priority: number; url: string }[]>
```

**Linear SDK call**:

```typescript
const client = new LinearClient({ apiKey })
// Uses client.issueSearch(query, { filter }) or client.issues({ filter })
// then optionally filters by state name in-memory
```

---

## Plane SDK Equivalent

### Option A — Simple keyword search

**SDK method**: `client.workItems.search`

```typescript
import { PlaneClient } from '@makeplane/plane-node-sdk'

const client = new PlaneClient({ apiKey })

const results = await client.workItems.search(
  workspaceSlug,
  query,
  projectId, // optional: scope to specific project
)
// Returns WorkItemSearch results
```

### Option B — Advanced filtered search

**SDK method**: `client.workItems.advancedSearch`

```typescript
const results = await client.workItems.advancedSearch(workspaceSlug, {
  query, // keyword search
  filters: {
    and: [
      // Filter by state (requires state ID, not name)
      state !== undefined ? { state_id: stateId } : undefined,

      // Filter by label
      labelId !== undefined ? { label_id: labelId } : undefined,

      // Filter by due date range
      dueDateBefore !== undefined ? { target_date: { lte: dueDateBefore } } : undefined,

      dueDateAfter !== undefined ? { target_date: { gte: dueDateAfter } } : undefined,

      // Filter by priority
      // (no direct estimate/relation filter in advancedSearch)
    ].filter(Boolean),
  },
  limit: 100,
})

// Returns AdvancedSearchResult[]
```

### Option C — List with filters (most feature-complete)

```typescript
const response = await client.workItems.list(workspaceSlug, projectId, {
  state: stateId, // state ID (not name)
  limit: 100,
})
```

---

## Key Differences

| Aspect          | Linear                         | Plane                                                          |
| --------------- | ------------------------------ | -------------------------------------------------------------- |
| State filter    | State **name** string          | State **ID** — must resolve name → ID via `client.states.list` |
| Label filter    | Name or ID                     | ID only in `advancedSearch`                                    |
| Date filter     | `dueDate` field                | `target_date` field                                            |
| Relation filter | `hasRelations`, `relationType` | Not supported in search filters                                |
| Estimate filter | Direct `estimate` filter       | Not supported in search/advanced search                        |
| Return type     | Flat `IssueResult[]`           | `AdvancedSearchResult[]` or `PaginatedResponse<WorkItem>`      |
| Cross-project   | Supported                      | `advancedSearch` is workspace-level; `list` is per-project     |

## Migration Notes

- **State filter**: Linear accepts the state name directly and resolves it. Plane requires a state ID. Pre-resolve: `const states = await client.states.list(workspaceSlug, projectId)`.
- **Relation filtering** (`hasRelations`, `relationType`) is not natively supported by Plane's search API. Fetch all and filter client-side, or use the relations endpoint.
- **Estimate filtering** is not directly available in Plane's search. Consider filtering client-side after listing.
- For cross-project search, use `client.workItems.advancedSearch` (workspace-level). For single-project, `client.workItems.list` with filter params is simpler.
- `identifier` in the result must be constructed: `${project.identifier}-${workItem.sequence_id}`.
- `priority` is returned as a string enum in Plane vs an integer in Linear.
