# Mapping: `archiveProject` → Plane SDK

## Linear Implementation

**File**: `src/linear/archive-project.ts`

```typescript
archiveProject({ apiKey, projectId }):
  Promise<{ id: string; success: true }>
```

**Linear SDK call**:
```typescript
const client = new LinearClient({ apiKey })
const project = await client.project(projectId)
await project.archive()
// returns { id, success: true }
```

---

## Plane SDK Equivalent

**Context**: In Plane's terminology, a Linear **Project** maps to a Plane **Module** (feature grouping within a Plane Project). A Linear **Team** maps to a Plane **Project**.

Depending on the intent:

### Option A — Archive a Plane Module (= Linear Project)

Plane has no dedicated `archiveModule` method. Set `status` to `'COMPLETED'` or delete.

```typescript
import { PlaneClient } from '@makeplane/plane-node-sdk'

const client = new PlaneClient({ apiKey })

// Mark module as completed (closest to "archived")
const updated = await client.modules.update(
  workspaceSlug,
  projectId,       // Plane Project ID (= Linear Team ID)
  moduleId,        // Plane Module ID (= Linear Project ID)
  { status: 'COMPLETED' }
)
```

### Option B — Delete a Plane Module (= Linear Project)

```typescript
await client.modules.delete(workspaceSlug, projectId, moduleId)
// Returns: void
```

### Option C — Archive a Plane Project (= Linear Team)

Plane projects have an `archived_at` field; set it via update:

```typescript
const updated = await client.projects.update(
  workspaceSlug,
  planeProjectId,
  { archived_at: new Date() }
)
```

---

## Key Differences

| Aspect | Linear | Plane |
|--------|--------|-------|
| Terminology | "Project" | Module (if Linear Team→Project mapping), or Project (if Linear Project→Module mapping) |
| Operation | Dedicated `archive()` method on project | No dedicated archive; use `update(status: 'COMPLETED')` or `delete()` |
| Return value | `{ id, success: true }` | Updated Module/Project object or `void` |
| Reversibility | Linear has `unarchiveProject()` | Set `status` back or restore via update |

## Migration Notes

- Clarify which Plane entity corresponds to a "project" in your domain:
  - If migrating from Linear where **Team** = top-level org unit → Plane **Project**
  - If migrating from Linear where **Project** = feature grouping → Plane **Module**
- The safest non-destructive equivalent is updating `status` to `'COMPLETED'` on a Module rather than deleting it.
- Plane does not expose a first-class `archiveProject` SDK method; submit a feature request or use the REST API directly if needed.
