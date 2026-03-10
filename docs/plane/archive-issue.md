# Mapping: `archiveIssue` → Plane SDK

## Linear Implementation

**File**: `src/linear/archive-issue.ts`

```typescript
archiveIssue({ apiKey, issueId }):
  Promise<{ id: string; identifier: string; title: string; archivedAt: string } | undefined>
```

**Linear SDK call**:

```typescript
const client = new LinearClient({ apiKey })
const payload = await client.archiveIssue(issueId)
const issue = await payload.entity
// returns { id, identifier, title, archivedAt }
```

---

## Plane SDK Equivalent

**SDK method**: `client.workItems.update` (set `archived_at` timestamp)

Plane has no dedicated `archiveWorkItem` method. Archiving is achieved by setting the `archived_at` field on the work item.

```typescript
import { PlaneClient } from '@makeplane/plane-node-sdk'

const client = new PlaneClient({ apiKey })

const now = new Date().toISOString().split('T')[0] // YYYY-MM-DD

const updated = await client.workItems.update(workspaceSlug, projectId, workItemId, {
  archived_at: now,
})

// Returns updated WorkItem with archived_at set
// { id, name, sequence_id, archived_at, ... }
```

To check if a work item is archived, inspect `workItem.archived_at !== null`.

---

## Key Differences

| Aspect       | Linear                                  | Plane                                                      |
| ------------ | --------------------------------------- | ---------------------------------------------------------- |
| Operation    | Dedicated `archiveIssue()` mutation     | Set `archived_at` field via `update()`                     |
| Return value | `{ id, identifier, title, archivedAt }` | Full `WorkItem` object                                     |
| Reversible   | Linear has `unarchiveIssue()`           | Set `archived_at: null` to unarchive                       |
| Identifier   | `identifier` e.g. `ENG-42`              | Must construct from `${project.identifier}-${sequence_id}` |
| Date format  | ISO 8601 datetime string                | YYYY-MM-DD string (date only)                              |

## Migration Notes

- Plane's `archived_at` field accepts a YYYY-MM-DD date string (not a full datetime).
- The `archived_at` field may not be in the `UpdateWorkItem` interface in older SDK versions; verify against the installed SDK version.
- To unarchive: call `client.workItems.update(..., { archived_at: null })`.
- Linear returns `archivedAt` as a datetime; Plane stores only a date. When comparing, normalize to date-only.
- Archived work items are typically hidden from default list/search results; use explicit filters to include them.
