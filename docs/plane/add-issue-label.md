# Mapping: `addIssueLabel` → Plane SDK

## Linear Implementation

**File**: `src/linear/add-issue-label.ts`

```typescript
addIssueLabel({ apiKey, issueId, labelId }):
  Promise<{ id: string; identifier: string; title: string; url: string }>
```

**Linear SDK call**:

```typescript
const client = new LinearClient({ apiKey })
const payload = await client.issueAddLabel(issueId, labelId)
const issue = await payload.issue
// returns updated issue { id, identifier, title, url }
```

---

## Plane SDK Equivalent

**SDK method**: `client.workItems.retrieve` + `client.workItems.update`

Plane has no dedicated "add label" method. Labels are managed as an array on the work item via update.

```typescript
import { PlaneClient } from '@makeplane/plane-node-sdk'

const client = new PlaneClient({ apiKey })

// Step 1: Retrieve current labels
const workItem = await client.workItems.retrieve(
  workspaceSlug,
  projectId,
  workItemId,
  ['labels'], // expand labels to get full objects
)

const currentLabelIds = workItem.labels ?? []

// Step 2: Update with the new label appended
const updated = await client.workItems.update(workspaceSlug, projectId, workItemId, {
  labels: [...(currentLabelIds as string[]), labelId],
})

// Returns updated WorkItem
```

---

## Key Differences

| Aspect       | Linear                                         | Plane                               |
| ------------ | ---------------------------------------------- | ----------------------------------- |
| Operation    | Dedicated `issueAddLabel(issueId, labelId)`    | Read-modify-write on `labels` array |
| Atomicity    | Single API call                                | Two API calls (retrieve + update)   |
| Return value | Updated issue `{ id, identifier, title, url }` | Updated `WorkItem` object           |
| Label scope  | Labels are per-team                            | Labels are per-project              |

## Migration Notes

- Plane requires a read-modify-write pattern: fetch current `labels`, append the new ID, then update.
- If using expanded `labels`, the returned value may be full `Label` objects; extract `.id` before passing back to update.
- Race conditions are not a concern for papai: each bot interaction is single-threaded per user, and the LLM executes tool calls sequentially within one `generateText` session.
- `identifier` in Linear (e.g. `ENG-123`) corresponds to `sequence_id` in Plane; there is no composite `identifier` field unless built manually as `${project.identifier}-${workItem.sequence_id}`.
