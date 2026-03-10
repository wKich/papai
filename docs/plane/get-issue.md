# Mapping: `getIssue` → Plane SDK

## Linear Implementation

**File**: `src/linear/get-issue.ts`

```typescript
getIssue({ apiKey, issueId }): Promise<{
  id: string
  identifier: string
  title: string
  description: string | undefined
  priority: number
  url: string
  dueDate: string | null | undefined
  estimate: number | null | undefined
  state: string | undefined
  assignee: string | undefined
  labels: { id: string; name: string; color: string }[]
  relations: { id: string; type: string; relatedIssueId: string | undefined; relatedIdentifier: string | undefined }[]
}>
```

**Linear SDK call**:

```typescript
const client = new LinearClient({ apiKey })
const issue = await client.issue(issueId)
// then fetches: state, assignee, labels(), relations() in parallel
```

---

## Plane SDK Equivalent

**SDK method**: `client.workItems.retrieve` with field expansion

```typescript
import { PlaneClient } from '@makeplane/plane-node-sdk'

const client = new PlaneClient({ apiKey })

// Retrieve work item with all relevant fields expanded
const workItem = await client.workItems.retrieve(
  workspaceSlug,
  projectId,
  workItemId,
  ['state', 'assignees', 'labels'], // expand to get full objects, not just IDs
)

// Retrieve relations separately
const relations = await client.workItems.relations.list(workspaceSlug, projectId, workItemId)

// Returns:
// workItem: WorkItem with state/assignees/labels as objects
// relations: {
//   blocking: string[], blocked_by: string[], duplicate: string[],
//   relates_to: string[], start_before: string[], start_after: string[],
//   finish_before: string[], finish_after: string[]
// }
```

### Building the response shape

```typescript
const identifier = `${projectIdentifier}-${workItem.sequence_id}`
const url = `${baseUrl}/${workspaceSlug}/projects/${projectId}/issues/${workItem.id}`

return {
  id: workItem.id,
  identifier,
  name: workItem.name, // Linear: title → Plane: name
  description: workItem.description_html, // HTML not Markdown
  priority: workItem.priority, // Plane: string enum, not integer
  url,
  target_date: workItem.target_date, // Linear: dueDate → Plane: target_date
  estimate_point: workItem.estimate_point,
  state: (workItem.state as State)?.name,
  assignees: (workItem.assignees as User[])?.map((a) => a.display_name),
  labels: (workItem.labels as Label[])?.map((l) => ({ id: l.id, name: l.name, color: l.color })),
  relations,
}
```

---

## Key Differences

| Aspect      | Linear                          | Plane                                                   |
| ----------- | ------------------------------- | ------------------------------------------------------- |
| Scope       | `issueId` only                  | `workspaceSlug` + `projectId` + `workItemId`            |
| Identifier  | `identifier` (`ENG-42`)         | Must construct from `sequence_id` + project prefix      |
| Description | Markdown string                 | HTML string (`description_html`)                        |
| Priority    | Integer `0–4`                   | String enum (`none`, `urgent`, `high`, `medium`, `low`) |
| Due date    | `dueDate`                       | `target_date` (YYYY-MM-DD)                              |
| Estimate    | `estimate` (number)             | `estimate_point` (string)                               |
| Assignee    | Single `assignee` (string name) | `assignees` (array)                                     |
| Relations   | Array with full objects         | Grouped by type as `{ blocking: string[], ... }`        |
| URL         | Direct `url` property           | Must construct manually                                 |
| Expansion   | Auto-resolved via lazy loading  | Explicit `expand` array required                        |

## Migration Notes

- Use the `expand` parameter to avoid N+1 queries: `['state', 'assignees', 'labels']`.
- Relations are returned as a grouped object keyed by type, not a flat array. Map each type's array to relation objects.
- Linear's `issueId` can be passed directly to `client.issue(id)`. Plane requires knowing the `projectId` upfront. Use `client.workItems.retrieveByIdentifier(workspaceSlug, 'PROJ-42')` if only the identifier is known.
- The `description` is HTML in Plane; parse with a HTML-to-Markdown library if Markdown output is required.
- A single `assignee` in Linear becomes an `assignees` array in Plane; take the first element for backward compatibility.
