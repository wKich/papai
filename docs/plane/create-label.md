# Mapping: `createLabel` → Plane SDK

## Linear Implementation

**File**: `src/linear/create-label.ts`

```typescript
createLabel({ apiKey, teamId, name, color }):
  Promise<{ id: string; name: string; color: string }>
```

**Linear SDK call**:
```typescript
const client = new LinearClient({ apiKey })
const payload = await client.createIssueLabel({ teamId, name, color })
const label = await payload.issueLabel
// returns { id, name, color }
```

---

## Plane SDK Equivalent

**SDK method**: `client.labels.create`

```typescript
import { PlaneClient } from '@makeplane/plane-node-sdk'

const client = new PlaneClient({ apiKey })

const label = await client.labels.create(
  workspaceSlug,  // workspace identifier
  projectId,      // Linear: teamId → Plane: projectId
  {
    name,         // same field name
    color,        // same concept; hex string e.g. '#FF0000'
    // description is optional in Plane, no equivalent in Linear
  }
)

// Returns Label { id, name, color, description, project, workspace, ... }
```

---

## Key Differences

| Aspect | Linear | Plane |
|--------|--------|-------|
| Scope | `teamId` | `workspaceSlug` + `projectId` |
| SDK call | `client.createIssueLabel` | `client.labels.create` |
| Description | Not supported | Optional `description` field |
| Return value | `{ id, name, color }` | Full `Label` object |
| Parent label | Not available | Optional `parent` (label ID) — supports label hierarchy |

## Migration Notes

- Labels in Linear are scoped to a **team**; in Plane they are scoped to a **project**. When migrating, the `teamId` becomes the `projectId`.
- Plane supports a `parent` field for nested label hierarchies — a feature Linear does not have.
- The `color` format is the same (hex string), but Plane does not enforce a leading `#`; normalize to `#RRGGBB` for consistency.
- Workspace-level labels (shared across all projects) are not supported in this SDK version; each label belongs to a specific project.
