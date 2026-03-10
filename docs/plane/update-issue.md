# Mapping: `updateIssue` → Plane SDK

## Linear Implementation

**File**: `src/linear/update-issue.ts`

```typescript
updateIssue({ apiKey, issueId, status, assigneeId, dueDate, labelIds, estimate, projectId }):
  Promise<{ id: string; identifier: string; title: string; url: string }>
```

**Linear SDK call**:

```typescript
const client = new LinearClient({ apiKey })
// Resolves status name → stateId by fetching team's workflow states
// Then: await client.updateIssue(issueId, { stateId, assigneeId, dueDate, labelIds, estimate })
```

---

## Plane SDK Equivalent

**SDK method**: `client.workItems.update`

```typescript
import { PlaneClient } from '@makeplane/plane-node-sdk'

const client = new PlaneClient({ apiKey })

// Step 1: Resolve state name → state ID (if updating status)
let stateId: string | undefined
if (status !== undefined) {
  const states = await client.states.list(workspaceSlug, projectId)
  const state = states.results.find((s) => s.name.toLowerCase() === status.toLowerCase())
  if (state !== undefined) {
    stateId = state.id
  }
}

// Step 2: Priority mapping (if needed)
const priorityMap: Record<number, string> = {
  0: 'none',
  1: 'urgent',
  2: 'high',
  3: 'medium',
  4: 'low',
}

// Step 3: Update the work item
const updated = await client.workItems.update(workspaceSlug, projectId, workItemId, {
  state: stateId,
  assignees: assigneeId !== undefined ? [assigneeId] : undefined,
  target_date: dueDate, // Linear: dueDate → Plane: target_date (YYYY-MM-DD)
  labels: labelIds, // same concept
  // estimate_point: omitted — see conflicts/estimate-point.md
  // Linear projectId → Plane moduleId (if moving between modules)
  module: moduleId,
})

// Returns updated WorkItem
```

---

## Key Differences

| Aspect           | Linear                           | Plane                                                     |
| ---------------- | -------------------------------- | --------------------------------------------------------- |
| Scope            | `issueId`                        | `workspaceSlug` + `projectId` + `workItemId`              |
| Status field     | `stateId` (resolved from name)   | `state` (state ID)                                        |
| Assignee         | `assigneeId` (single string)     | `assignees` (array of IDs)                                |
| Due date field   | `dueDate`                        | `target_date` (YYYY-MM-DD)                                |
| Estimate field   | `estimate` (number)              | `estimate_point` (integer index as string, not the value) |
| Project move     | `projectId`                      | `module` (Plane module ID)                                |
| Return value     | `{ id, identifier, title, url }` | Full `WorkItem` object                                    |
| State resolution | Fetches team's workflow states   | Fetches project's states via `client.states.list`         |

## Migration Notes

- State name resolution is still required in Plane — call `client.states.list(workspaceSlug, projectId)` and match by name case-insensitively, same as the Linear implementation.
- Linear's single `assigneeId` becomes `assignees: [assigneeId]` in Plane (array).
- `dueDate` → `target_date`. Ensure the format is `YYYY-MM-DD` (not full ISO 8601 datetime).
- **`estimate_point` is not a simple string coercion.** Plane stores a positional index (0–7) into the project's configured estimate scale, not the actual value. `String(estimate)` is semantically incorrect. See [`conflicts/estimate-point.md`](conflicts/estimate-point.md) for the full analysis and recommended mapping strategy.
- Moving an issue between projects (Linear `projectId`) maps to moving between Plane modules (`module` field), not between Plane projects.
- The return value does not contain `identifier` or `url` directly; construct: `${project.identifier}-${workItem.sequence_id}` and the URL manually.
