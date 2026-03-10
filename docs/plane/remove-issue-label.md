# Mapping: `removeIssueLabel` → Plane SDK

## Linear Implementation

**File**: `src/linear/remove-issue-label.ts`

```typescript
removeIssueLabel({ apiKey, issueId, labelId }):
  Promise<{ id: string; identifier: string; title: string; url: string } | undefined>
```

**Linear SDK call**:

```typescript
const client = new LinearClient({ apiKey })
const payload = await client.issueRemoveLabel(issueId, labelId)
const issue = await payload.issue
// returns updated issue { id, identifier, title, url }
```

---

## Plane SDK Equivalent

**SDK method**: `client.workItems.retrieve` + `client.workItems.update`

Plane has no dedicated "remove label" method. Labels are managed as an array; remove by fetching current labels and updating with the target label excluded.

```typescript
import { PlaneClient } from '@makeplane/plane-node-sdk'

const client = new PlaneClient({ apiKey })

// Step 1: Retrieve current labels
const workItem = await client.workItems.retrieve(
  workspaceSlug,
  projectId,
  workItemId,
  ['labels'], // expand to get label objects or IDs
)

const currentLabelIds = (workItem.labels as string[]) ?? []
const updatedLabelIds = currentLabelIds.filter((id) => id !== labelId)

// Step 2: Update with the label removed
const updated = await client.workItems.update(workspaceSlug, projectId, workItemId, {
  labels: updatedLabelIds,
})

// Returns updated WorkItem
```

---

## Key Differences

| Aspect       | Linear                                         | Plane                               |
| ------------ | ---------------------------------------------- | ----------------------------------- |
| Operation    | Dedicated `issueRemoveLabel(issueId, labelId)` | Read-modify-write on `labels` array |
| Atomicity    | Single API call                                | Two API calls (retrieve + update)   |
| Return value | Updated issue `{ id, identifier, title, url }` | Updated `WorkItem` object           |
| Label scope  | Per-team                                       | Per-project                         |

## Migration Notes

- Same read-modify-write pattern as `addIssueLabel` — retrieve current labels, filter out the target, then update.
- If `labels` is returned as an array of `Label` objects (when expanded), extract `.id` from each before filtering.
- Race conditions are not a concern for papai: each bot interaction is single-threaded per user, and the LLM executes tool calls sequentially within one `generateText` session.
- The returned `WorkItem` does not have a `url` property; construct it manually: `${baseUrl}/${workspaceSlug}/projects/${projectId}/issues/${workItemId}`.
