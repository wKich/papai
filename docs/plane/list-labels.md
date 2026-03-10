# Mapping: `listLabels` → Plane SDK

## Linear Implementation

**File**: `src/linear/list-labels.ts`

```typescript
listLabels({ apiKey, teamId }):
  Promise<{ id: string; name: string; color: string }[]>
```

**Linear SDK call**:

```typescript
const client = new LinearClient({ apiKey })
const team = await client.team(teamId)
const labels = await team.labels()
// returns IssueLabel[] { id, name, color }
```

---

## Plane SDK Equivalent

**SDK method**: `client.labels.list`

```typescript
import { PlaneClient } from '@makeplane/plane-node-sdk'

const client = new PlaneClient({ apiKey })

const response = await client.labels.list(
  workspaceSlug,
  projectId, // Linear: teamId → Plane: projectId
  { limit: 100 },
)

// Returns PaginatedResponse<Label>
const labels = response.results.map((l) => ({
  id: l.id ?? '',
  name: l.name,
  color: l.color ?? '#000000',
}))
```

---

## Key Differences

| Aspect       | Linear                        | Plane                                                                        |
| ------------ | ----------------------------- | ---------------------------------------------------------------------------- |
| Scope        | `teamId`                      | `workspaceSlug` + `projectId`                                                |
| Navigation   | `team.labels()` lazy relation | Direct `client.labels.list()` call                                           |
| Return type  | Flat array                    | `PaginatedResponse<Label>`                                                   |
| Extra fields | `id`, `name`, `color`         | Also `description`, `parent`, `sort_order`, `external_source`, `external_id` |
| Hierarchy    | Flat                          | `parent` field enables nested label hierarchies                              |

## Migration Notes

- Labels in Linear are per-team; in Plane they are per-project. The `teamId` becomes `projectId`.
- The response is paginated — iterate with `limit`/`offset` if the project has many labels.
- `color` and `id` are optional in the Plane `Label` type; add null guards when mapping.
- Plane supports hierarchical labels via the `parent` field. If you use label hierarchies, recursively resolve parent labels for a full tree.
- Workspace-level shared labels are not supported in the current SDK; each label is scoped to one project.
