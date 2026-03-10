# Mapping: `createIssue` → Plane SDK

## Linear Implementation

**File**: `src/linear/create-issue.ts`

```typescript
createIssue({ apiKey, title, description, priority, projectId, teamId, dueDate, labelIds, estimate }):
  Promise<LinearFetch<Issue> | undefined>
```

**Linear SDK call**:

```typescript
const client = new LinearClient({ apiKey })
const payload = await client.createIssue({
  title,
  description,
  priority, // 0=none, 1=urgent, 2=high, 3=medium, 4=low
  projectId, // optional Linear project grouping
  teamId, // required: which team owns the issue
  dueDate, // ISO 8601 string
  labelIds, // string[]
  estimate, // number
})
const issue = await payload.issue
// returns Issue { id, identifier, title, ... }
```

---

## Plane SDK Equivalent

**SDK method**: `client.workItems.create`

```typescript
import { PlaneClient } from '@makeplane/plane-node-sdk'

const client = new PlaneClient({ apiKey })

// Priority mapping: Linear number → Plane string
const priorityMap: Record<number, string> = {
  0: 'none',
  1: 'urgent',
  2: 'high',
  3: 'medium',
  4: 'low',
}

const workItem = await client.workItems.create(
  workspaceSlug, // required: workspace identifier
  projectId, // required: Plane Project ID (= Linear teamId)
  {
    name: title, // Linear: title → Plane: name
    description_html: description ? `<p>${description}</p>` : undefined, // Linear: Markdown → Plane: HTML
    priority: priorityMap[priority ?? 0], // Linear: number → Plane: string enum
    labels: labelIds, // same concept, different field name
    target_date: dueDate, // Linear: dueDate → Plane: target_date (YYYY-MM-DD)
    // estimate_point: omitted — see conflicts/estimate-point.md
    // projectId (Linear grouping) → module: moduleId in Plane (if needed)
    state: stateId, // must resolve state name → ID first
  },
)

// Returns WorkItem { id, name, sequence_id, priority, labels, state, ... }
```

---

## Key Differences

| Aspect           | Linear                     | Plane                                                            |
| ---------------- | -------------------------- | ---------------------------------------------------------------- |
| Required scope   | `teamId`                   | `workspaceSlug` + `projectId`                                    |
| Title field      | `title`                    | `name`                                                           |
| Description      | Markdown string            | HTML string (`description_html`)                                 |
| Priority         | Integer `0–4`              | String enum: `'none'`, `'urgent'`, `'high'`, `'medium'`, `'low'` |
| Due date field   | `dueDate`                  | `target_date` (accepts YYYY-MM-DD)                               |
| Estimate field   | `estimate` (number)        | `estimate_point` (integer index as string, not the value)        |
| Label field      | `labelIds` (string[])      | `labels` (string[])                                              |
| Project grouping | `projectId` (optional)     | `module` (optional module ID)                                    |
| Identifier       | `identifier` e.g. `ENG-42` | `sequence_id` + project `identifier` prefix                      |
| State            | Automatic default          | Requires explicit `state` (state ID) or omit for default         |

## Migration Notes

- The `teamId` in Linear corresponds to the `projectId` in Plane.
- A Linear `projectId` (feature grouping) corresponds to a Plane `module` ID.
- Descriptions must be converted from Markdown to HTML. Use a library like `marked` for production use.
- **`estimate_point` is not a simple string coercion.** Plane stores a positional index (0–7) into the project's configured estimate scale, not the actual value. `String(estimate)` is semantically incorrect. See [`conflicts/estimate-point.md`](conflicts/estimate-point.md) for the full analysis and recommended mapping strategy.
- To resolve a state name to a state ID before creating, call `client.states.list(workspaceSlug, projectId)`.
- The returned `WorkItem` has `sequence_id` (number); the human-readable identifier is `${projectIdentifier}-${sequence_id}`.
