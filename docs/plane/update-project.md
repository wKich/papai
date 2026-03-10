# Mapping: `updateProject` → Plane SDK

## Linear Implementation

**File**: `src/linear/update-project.ts`

```typescript
updateProject({ apiKey, projectId, name, description }):
  Promise<{ id: string; name: string; url: string }>
```

**Linear SDK call**:

```typescript
const client = new LinearClient({ apiKey })
const payload = await client.updateProject(projectId, { name, description })
const project = await payload.project
// returns { id, name, url }
```

**Validation**: Throws if neither `name` nor `description` is provided.

---

## Plane SDK Equivalent

**Terminology mapping**: A Linear **Project** corresponds to a Plane **Module**. A Linear **Team** corresponds to a Plane **Project**.

### Option A — Update a Plane Module (= Linear Project)

**SDK method**: `client.modules.update`

```typescript
import { PlaneClient } from '@makeplane/plane-node-sdk'

const client = new PlaneClient({ apiKey })

if (name === undefined && description === undefined) {
  throw new Error('At least one field must be provided to update a module')
}

const updated = await client.modules.update(
  workspaceSlug,
  projectId, // Plane Project ID (= Linear teamId)
  moduleId, // Plane Module ID (= Linear projectId)
  {
    name,
    description,
  },
)

// Returns updated Module { id, name, description, status, start_date, target_date, ... }
```

### Option B — Update a Plane Project (= Linear Team)

**SDK method**: `client.projects.update`

```typescript
const updated = await client.projects.update(workspaceSlug, planeProjectId, {
  name,
  description,
})

// Returns updated Project { id, name, identifier, workspace, ... }
```

---

## Key Differences

| Aspect       | Linear                | Plane                                                  |
| ------------ | --------------------- | ------------------------------------------------------ |
| Scope param  | `projectId` only      | `workspaceSlug` + `projectId` (+ `moduleId` if module) |
| Return value | `{ id, name, url }`   | Full Module or Project object (no `url`)               |
| URL field    | Direct `url` property | Must construct manually                                |
| Extra fields | `name`, `description` | Module also has `status`, `start_date`, `target_date`  |

## Migration Notes

- Determine which Plane entity (Module or Project) corresponds to a Linear Project before calling this.
- The return value does not contain `url`; construct it as `${baseUrl}/${workspaceSlug}/projects/${planeProjectId}/modules/${moduleId}` for modules.
- The same at-least-one-field validation should be kept.
- Plane Modules have additional updatable fields (`status`, `start_date`, `target_date`) that have no Linear equivalent — pass them as `undefined` to leave unchanged.
- If using Plane Projects (= Linear Teams), the `identifier` prefix cannot be changed after creation.
