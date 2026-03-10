# Mapping: `listProjects` → Plane SDK

## Linear Implementation

**File**: `src/linear/list-projects.ts`

```typescript
listProjects({ apiKey }):
  Promise<{ teamId: string; teamName: string; projects: { id: string; name: string }[] }[]>
```

**Linear SDK call**:
```typescript
const client = new LinearClient({ apiKey })
const teams = await client.teams()
// for each team: const projects = await team.projects()
// returns [{ teamId, teamName, projects: [{ id, name }] }]
```

**Concept**: Lists all teams, and for each team, all projects within it.

---

## Plane SDK Equivalent

**Terminology mapping**:
- Linear **Team** → Plane **Project**
- Linear **Project** (grouping within a team) → Plane **Module**

### Option A — List Plane Projects (= Linear Teams)

```typescript
import { PlaneClient } from '@makeplane/plane-node-sdk'

const client = new PlaneClient({ apiKey })

const response = await client.projects.list(workspaceSlug, { limit: 100 })

// Returns PaginatedResponse<Project>
const projects = response.results.map(p => ({
  id: p.id,
  name: p.name,
  identifier: p.identifier,
}))
```

### Option B — List Projects with their Modules (= Linear Teams + Projects)

```typescript
import { PlaneClient } from '@makeplane/plane-node-sdk'

const client = new PlaneClient({ apiKey })

const projectsResponse = await client.projects.list(workspaceSlug, { limit: 100 })

const result = await Promise.all(
  projectsResponse.results.map(async (project) => {
    const modulesResponse = await client.modules.list(workspaceSlug, project.id)
    return {
      projectId: project.id,
      projectName: project.name,
      modules: modulesResponse.results.map(m => ({ id: m.id, name: m.name })),
    }
  })
)
// equivalent to: [{ teamId, teamName, projects: [...] }]
```

---

## Key Differences

| Aspect | Linear | Plane |
|--------|--------|-------|
| Top-level entity | Team | Project |
| Nested entity | Project (within team) | Module (within Project) |
| Scope | Workspace-wide (no extra param) | Requires `workspaceSlug` |
| Return type | Nested array | Paginated; need separate call per project for modules |
| API calls | 1 (teams) + N (team.projects) | 1 (projects) + N (modules per project) |

## Migration Notes

- The Linear function returns a flat team → projects structure. Replicate this in Plane by listing projects then fetching modules per project.
- Each `client.modules.list` call requires a separate `await` per project — N+1 pattern. For large workspaces, add concurrency control.
- Plane modules have richer metadata than Linear projects: `status`, `start_date`, `target_date`, `progress_snapshot`.
- If the goal is only to list top-level containers (equivalent to Linear teams), `client.projects.list` alone is sufficient.
- Projects in Plane have an `identifier` prefix (e.g. `ENG`) used in composite issue identifiers.
