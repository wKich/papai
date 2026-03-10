# Mapping: `createProject` → Plane SDK

## Linear Implementation

**File**: `src/linear/create-project.ts`

```typescript
createProject({ apiKey, teamId, name, description }):
  Promise<{ id: string; name: string; url: string }>
```

**Linear SDK call**:
```typescript
const client = new LinearClient({ apiKey })
const payload = await client.createProject({ teamIds: [teamId], name, description })
const project = await payload.project
// returns { id, name, url }
```

---

## Plane SDK Equivalent

**Important terminology note**: A Linear **Project** (feature grouping under a team) maps to a Plane **Module**. If you are creating a top-level workspace container (equivalent to a Linear Team), use `client.projects.create`.

### Option A — Create a Plane Module (≈ Linear Project)

```typescript
import { PlaneClient } from '@makeplane/plane-node-sdk'

const client = new PlaneClient({ apiKey })

const module = await client.modules.create(
  workspaceSlug,
  projectId,       // the Plane Project this module belongs to (= Linear teamId)
  {
    name,
    description,
    // Optional timeline fields:
    start_date: undefined,   // YYYY-MM-DD
    target_date: undefined,  // YYYY-MM-DD
    status: 'IN_PROGRESS',
  }
)

// Returns Module { id, name, description, start_date, target_date, status, ... }
```

### Option B — Create a Plane Project (≈ Linear Team)

```typescript
const project = await client.projects.create(
  workspaceSlug,
  {
    name,
    description: description ?? '',
    identifier,    // auto-generated from name if omitted; e.g. 'ENG'
    network: 0,    // 0=secret, 2=public
  }
)

// Returns Project { id, name, identifier, workspace, ... }
```

---

## Key Differences

| Aspect | Linear | Plane |
|--------|--------|-------|
| Concept | Project (feature grouping) | Module (if Linear Project) or Project (if Linear Team) |
| Scope param | `teamIds: [teamId]` | `workspaceSlug` + `projectId` for Module |
| URL field | `url` in return value | No `url` field — must construct manually |
| Identifier | Auto-generated | Configurable `identifier` prefix (e.g. `ENG`) |
| Status | Not applicable | Module has `status` field |
| Timeline | Not in create | Module supports `start_date` + `target_date` |

## Migration Notes

- Decide upfront whether your use of Linear `project` maps to a Plane **Module** or a Plane **Project** based on your workspace hierarchy.
- Plane Modules belong to a Project and group work items within it — this is the closest semantic match to a Linear Project.
- The return value does not include a `url`; build it as `${baseUrl}/${workspaceSlug}/projects/${projectId}/modules/${module.id}`.
- A Module's `status` (`'IN_PROGRESS'`, `'PAUSED'`, `'COMPLETED'`, etc.) has no Linear equivalent and can be set to `'IN_PROGRESS'` by default.
