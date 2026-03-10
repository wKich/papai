# Linear Project → Plane Container: Architectural Mapping Decision

**Status**: Unresolved — requires one-time decision before implementing `create-project`, `update-project`, `list-projects`, `archive-project`  
**Severity**: High — cascades across four methods and affects issue assignment filtering  
**Research Date**: March 10, 2026

---

## 1. Problem Summary

Linear's data model has a two-level hierarchy below the workspace:

```
Linear Workspace → Teams → Projects → Issues
```

A **Linear Project** is a named, goal-oriented container for issues with a clear outcome — e.g., "Auth Revamp", "Q2 Data Migration". It has: name, description, status, members, target date, milestones, and can span multiple Teams.

Plane's data model has a different two-level hierarchy:

```
Plane Workspace → Projects → Work Items
```

But Plane Projects contain **sub-containers** (Modules, Cycles, Epics) that each serve different grouping purposes.

**The decision**: which Plane entity should a Linear Project map to? This choice cascades to all four project operations: `create-project`, `update-project`, `list-projects`, and `archive-project`.

---

## 2. Semantic Comparison

### Linear Project — key properties

| Property      | Notes                                                       |
| ------------- | ----------------------------------------------------------- |
| `name`        | Required, human-readable                                    |
| `description` | Optional rich text                                          |
| `status`      | `planned`, `inProgress`, `paused`, `completed`, `cancelled` |
| `members`     | Shared across teams                                         |
| `targetDate`  | Optional completion date                                    |
| `startDate`   | Optional start date                                         |
| `milestones`  | Sub-groupings within a project                              |
| `url`         | Permalink                                                   |
| Scope         | Can span multiple teams                                     |
| Archive       | `project.archive()` / `project.unarchive()`                 |

Linear describes Projects as: _"units of work that have a clear outcome or planned completion date, such as a new feature's launch"_.

### Plane container types vs Linear Project

| Dimension                 | **Plane Project**                          | **Plane Module**                                                            | **Plane Cycle**                                 | **Plane Epic**                                 |
| ------------------------- | ------------------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| Official description      | "Organizes team's work within a workspace" | "Smaller, focused projects to group work items within specific time frames" | "Time-boxed containers for work — like sprints" | "Groups related tasks into a larger work item" |
| Hierarchy level           | Top-level (below Workspace)                | Sub-container within a Project                                              | Sub-container within a Project                  | Work item parent within a Project              |
| Identifier space          | Own prefix (e.g. `ENG-123`)                | Inherits from parent Project                                                | Inherits from parent Project                    | Inherits from parent Project                   |
| `name`                    | ✓                                          | ✓                                                                           | ✓                                               | ✓                                              |
| `description`             | ✓                                          | ✓                                                                           | —                                               | ✓                                              |
| `status` field            | —                                          | `BACKLOG \| PENDING \| IN_PROGRESS \| PAUSED \| COMPLETED \| CANCELLED`     | `draft \| started \| completed`                 | Issue state                                    |
| `start_date`              | —                                          | ✓                                                                           | ✓ (required)                                    | —                                              |
| `target_date`             | —                                          | ✓                                                                           | ✓ (required, called `end_date`)                 | —                                              |
| `members`                 | ✓ (members, roles)                         | `lead` (single person)                                                      | `lead` (single person)                          | —                                              |
| Requires parent container | —                                          | ✓ (parent Plane Project)                                                    | ✓ (parent Plane Project)                        | ✓ (parent Plane Project)                       |
| Dates required on create  | —                                          | —                                                                           | **Yes, both required**                          | —                                              |
| Archive via SDK           | —                                          | — (see §3)                                                                  | ✓ `client.cycles.archive()`                     | —                                              |
| Archive via REST API      | ✓ `POST .../projects/{id}/archive/`        | ✓ `POST .../modules/{id}/archive/`                                          | ✓ `POST .../cycles/{id}/archive/`               | — (use issue archive)                          |
| Unarchive                 | ✓ (REST)                                   | ✓ (REST)                                                                    | ✓ `client.cycles.unArchive()`                   | —                                              |
| Delete                    | ✓ `client.projects.delete()`               | ✓ `client.modules.delete()`                                                 | ✓ `client.cycles.delete()`                      | ✓ (as work item)                               |
| Semantic match            | Linear Team                                | **Linear Project** ★                                                        | Linear Cycle / Sprint                           | Linear Milestone or Epic                       |

---

## 3. Archive Capability Detail

### Critical finding: the SDK lags behind the REST API

The published Plane REST API (`/api/v1/`) documents **archive endpoints for all three sub-container types**:

```
POST   /api/v1/workspaces/{slug}/projects/{project_id}/modules/{module_id}/archive/
DELETE /api/v1/workspaces/{slug}/projects/{project_id}/modules/{module_id}/unarchive/

POST   /api/v1/workspaces/{slug}/projects/{project_id}/cycles/{cycle_id}/archive/
DELETE /api/v1/workspaces/{slug}/projects/{project_id}/cycles/{cycle_id}/unarchive/

POST   /api/v1/workspaces/{slug}/projects/{project_id}/archive/
DELETE /api/v1/workspaces/{slug}/projects/{project_id}/unarchive/
```

Source: [developers.plane.so/api-reference/module/archive-module](https://developers.plane.so/api-reference/module/archive-module)

**SDK @makeplane/plane-node-sdk v0.2.8 gap:**

| Entity            | SDK archive method              | REST API archive |
| ----------------- | ------------------------------- | ---------------- |
| `client.cycles`   | ✓ `.archive()` / `.unArchive()` | ✓                |
| `client.modules`  | ✗ missing                       | ✓ documented     |
| `client.projects` | ✗ missing                       | ✓ documented     |

The module archive is a real operation that preserves data (unlike `delete`) and removes the module from the active modules list. This means the initial analysis in `archive-project.md` (which recommended `status: 'COMPLETED'` as a workaround) is outdated — a proper archive is available via direct HTTP.

---

## 4. Alternative Mappings — Ranked Analysis

### Option A: Linear Project → Plane Module ★ **Recommended**

**Premise**: Linear's workspace maps to Plane workspace. Linear Teams map to Plane Projects. Linear Projects map to Plane Modules within those Plane Projects.

```
Linear Workspace  →  Plane Workspace
Linear Team       →  Plane Project      (own identifier: ENG-123)
Linear Project    →  Plane Module       (grouped under relevant Plane Project)
Linear Issue      →  Plane Work Item
```

**Pros:**

- Closest semantic match: Plane's own docs describe Modules as "smaller, focused projects to group work items" — identical to Linear's definition
- Status vocabulary aligns: `BACKLOG / PENDING / IN_PROGRESS / PAUSED / COMPLETED / CANCELLED` maps directly to Linear's `planned / inProgress / paused / completed / cancelled`
- Optional dates: modules allow `start_date` and `target_date` but don't require them — matches Linear Projects which also have optional dates
- Archive exists in the REST API (even if SDK doesn't expose it in v0.2.8)
- Issues can be assigned to modules without changing their primary project membership
- No workspace namespace pollution (modules live inside projects, not as top-level entries)
- The `module_view` feature flag per Plane Project allows toggling the feature per team/project

**Cons:**

- Requires a parent Plane Project to exist for every module — adds a prerequisite lookup step
- SDK v0.2.8 doesn't expose `archive`/`unarchive` — requires a raw HTTP call workaround
- Module `lead` is a single user; Linear Projects allow full member lists — members are not fully preserved
- A Linear Issue can belong to a Project; in Plane a Work Item can belong to a Module — multi-module membership may differ from Linear's multi-team project behavior

**Archive workaround** (until SDK exposes it):

```typescript
// Direct REST call since client.modules.archive() doesn't exist in SDK v0.2.8
const response = await fetch(
  `${baseUrl}/api/v1/workspaces/${workspaceSlug}/projects/${planeProjectId}/modules/${moduleId}/archive/`,
  { method: 'POST', headers: { 'X-API-Key': apiKey } },
)
```

---

### Option B: Linear Project → Plane Project

**Premise**: Each Linear Project becomes its own top-level Plane Project.

```
Linear Workspace  →  Plane Workspace
Linear Team       →  (no mapping — absorbed into project names or ignored)
Linear Project    →  Plane Project      (own identifier space)
Linear Issue      →  Plane Work Item
```

**Pros:**

- No need for a parent-container prerequisite
- Full member management per project
- Archive via REST API exists (`POST .../projects/{id}/archive/`)
- Each project gets its own customizable states, labels, and settings

**Cons:**

- **Wrong hierarchical level**: Plane Projects are the equivalent of Linear Teams, not Linear Projects. This conflates two distinct concepts.
- **Workspace proliferation**: An organisation with 50 active Linear projects would have 50 Plane Projects, each with their own identifier space (`PROJ-1`, `AUTH-1`, `MIG-1`...). Cross-project views become difficult.
- **No team grouping**: Linear projects that belong to the same team lose that affiliation — there's no natural parent grouping in Plane for this structure.
- Linear issues already belong to a Team in Linear; in Plane, the Project is the primary container — this mapping loses the team-level grouping entirely.
- Identifier namespace fragmentation: 50 projects × their own identifier sequences makes issue references unmeaningful (`A-1`, `B-1`, `C-1` all look similar).

**Verdict**: Technically possible but architecturally wrong. Suitable only if the consuming system does not use Teams at all and treats the workspace flat.

---

### Option C: Linear Project → Plane Cycle

**Premise**: Map feature-projects to sprint-like cycles within a Plane Project.

**Pros:**

- Archive supported natively in SDK v0.2.8 (`client.cycles.archive()`)
- Clear time-bounding matches projects with definite end dates

**Cons:**

- **`start_date` and `end_date` are required fields** — Linear Projects with no target date cannot be created as cycles at all without fabricating dates.
- Cycles are semantically sprints, not features: Plane's documentation describes cycles as "time-boxed containers... like sprints" with regular cadence. Using them for evergreen feature projects is a semantic abuse.
- No `status` field that maps to Linear's lifecycle states.
- Cycles appear in a "Cycles" sidebar section, not under a named project grouping — the UX that Plane users see would be confusing.
- `name` + `start_date` + `end_date` is the complete API surface; no description, lead, or status.

**Verdict**: Only viable if all Linear Projects have non-null `startDate` and `targetDate`. Even then, the semantic mismatch creates user confusion in the Plane UI.

---

### Option D: Linear Project → Plane Epic

**Premise**: A Linear Project becomes a "parent work item" (Epic) that groups child issues.

**Pros:**

- Issues can be hierarchically linked (epic → child issues)
- Supported in the SDK as regular work items with `parent` or `type: 'Epic'`

**Cons:**

- **Epics are work items, not containers**: a Plane Epic is a `WorkItem` with `is_epic: true` or a specific `type`. It lives in the issue tracker, not as a project/module/cycle container. This means "list projects" becomes "list work items of type Epic" — an unnatural API surface.
- No dates on the epic itself separate from work item fields.
- No status distinct from work item states.
- Archive = archive the epic work item, which has its own separate complexity (see `archive-issue.md` for that conflict).
- Linear Project members don't map; epics have no membership.
- Epics require the `epics` feature flag to be enabled per Plane Project.

**Verdict**: Not viable for a general mapping. Epics cover the "milestone" or "initiative" niche within Plane, not the "project as container" niche.

---

### Option E: Hybrid (Modules for feature projects, Projects for standalone)

**Premise**: Use Plane Modules when a Linear Project belongs to one Team; create a new Plane Project when a Linear Project spans multiple Teams.

**Pros**: Preserves multi-team projects exactly.

**Cons:**

- Significant implementation complexity: the mapping entity type varies per record.
- Requires storing a `mapping_type` column alongside the `plane_id` in the mapping table.
- `list-projects` must query both entity types and merge/normalize results.
- `archive-project` / `update-project` dispatch on `mapping_type` at runtime.
- Two REST API shapes to maintain for every operation.

**Verdict**: Over-engineered for typical use. Most Linear Projects belong to a single Team. Worth revisiting only if multi-team projects are a critical use case.

---

## 5. Recommended Approach

**Linear Project → Plane Module**, with a fixed "home" Plane Project per Linear Team.

### Rationale

1. **Semantic precision**: Plane explicitly describes Modules as the feature-grouping layer ("smaller, focused projects") — this matches Linear Project semantics word for word.
2. **Status vocabulary parity**: Module's `ModuleStatusEnum` directly covers all Linear Project lifecycle states.
3. **Archive via REST API**: While the SDK v0.2.8 omits it, the public REST API endpoint exists and is stable. A thin helper function (`archiveModule`) calling the endpoint directly is a contained workaround.
4. **Hierarchy preservation**: `Linear Team → Plane Project` + `Linear Project → Plane Module` preserves both levels of the Linear hierarchy without namespace or UX distortion.
5. **Issue assignment**: Work items assignable to modules without changing their primary Plane Project, matching how Linear Issues belong to a Project without leaving their Team.

### Prerequisite

Before any module operation, a **parent Plane Project** must be resolved from the Linear Team ID. Storage requirement: a `linear_team_id → plane_project_id` mapping must be persisted (added to the user config or a separate DB table).

---

## 6. Cascade Impact

| Operation         | Under Recommended Mapping (Module)                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `create-project`  | `client.modules.create(workspaceSlug, planeProjectId, { name, description, status, start_date, target_date })` — needs `planeProjectId` lookup |
| `update-project`  | `client.modules.update(workspaceSlug, planeProjectId, moduleId, { name, description, status, start_date, target_date })`                       |
| `list-projects`   | `client.modules.list(workspaceSlug, planeProjectId)` — lists modules of one Plane Project; to list across all teams, iterate Plane Projects    |
| `archive-project` | Raw HTTP `POST .../modules/{id}/archive/` (SDK gap); response shape to define                                                                  |

**Affected fields per operation:**

| Linear Field  | Module Field  | Notes                                                                          |
| ------------- | ------------- | ------------------------------------------------------------------------------ |
| `name`        | `name`        | Direct                                                                         |
| `description` | `description` | Direct                                                                         |
| `status`      | `status`      | Enum mapping required (see §7)                                                 |
| `startDate`   | `start_date`  | Format: `YYYY-MM-DD` string                                                    |
| `targetDate`  | `target_date` | Format: `YYYY-MM-DD` string                                                    |
| `lead.id`     | `lead`        | Single user ID only                                                            |
| `members`     | —             | Not supported on modules                                                       |
| `milestones`  | —             | No equivalent; drop or handle separately                                       |
| `url`         | —             | Construct: `{baseUrl}/{workspaceSlug}/projects/{projectId}/modules/{moduleId}` |

---

## 7. Implementation Notes

### Status mapping

```typescript
// src/plane/mappers/project-status.ts
import type { ModuleStatusEnum } from '@makeplane/plane-node-sdk'

const LINEAR_TO_MODULE_STATUS: Record<string, ModuleStatusEnum> = {
  planned: 'BACKLOG',
  inProgress: 'IN_PROGRESS',
  paused: 'PAUSED',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
}

const MODULE_TO_LINEAR_STATUS: Record<ModuleStatusEnum, string> = {
  BACKLOG: 'planned',
  PENDING: 'planned',
  IN_PROGRESS: 'inProgress',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
}
```

### `create-project`

```typescript
// src/plane/create-project.ts
import { PlaneClient } from '@makeplane/plane-node-sdk'

export async function createProject(params: {
  apiKey: string
  workspaceSlug: string
  planeProjectId: string // resolved from Linear Team ID
  name: string
  description?: string
  status?: string
  startDate?: string
  targetDate?: string
}): Promise<{ id: string; name: string }> {
  const client = new PlaneClient({ apiKey: params.apiKey })

  const module = await client.modules.create(params.workspaceSlug, params.planeProjectId, {
    name: params.name,
    description: params.description,
    status: params.status ? LINEAR_TO_MODULE_STATUS[params.status] : 'BACKLOG',
    start_date: params.startDate,
    target_date: params.targetDate,
  })

  return { id: module.id, name: module.name }
}
```

### `update-project`

```typescript
// src/plane/update-project.ts
export async function updateProject(params: {
  apiKey: string
  workspaceSlug: string
  planeProjectId: string
  moduleId: string
  name?: string
  description?: string
  status?: string
  startDate?: string
  targetDate?: string
}): Promise<{ id: string }> {
  const client = new PlaneClient({ apiKey: params.apiKey })

  const module = await client.modules.update(params.workspaceSlug, params.planeProjectId, params.moduleId, {
    ...(params.name !== undefined && { name: params.name }),
    ...(params.description !== undefined && { description: params.description }),
    ...(params.status !== undefined && { status: LINEAR_TO_MODULE_STATUS[params.status] }),
    ...(params.startDate !== undefined && { start_date: params.startDate }),
    ...(params.targetDate !== undefined && { target_date: params.targetDate }),
  })

  return { id: module.id }
}
```

### `list-projects`

```typescript
// src/plane/list-projects.ts
export async function listProjects(params: {
  apiKey: string
  workspaceSlug: string
  planeProjectId: string
}): Promise<Array<{ id: string; name: string; status: string }>> {
  const client = new PlaneClient({ apiKey: params.apiKey })
  const result = await client.modules.list(params.workspaceSlug, params.planeProjectId)

  return result.results.map((m) => ({
    id: m.id,
    name: m.name,
    status: MODULE_TO_LINEAR_STATUS[m.status ?? 'BACKLOG'] ?? 'planned',
  }))
}
```

### `archive-project` (SDK gap workaround)

```typescript
// src/plane/archive-project.ts
export async function archiveProject(params: {
  apiKey: string
  baseUrl: string // e.g. 'https://api.plane.so'
  workspaceSlug: string
  planeProjectId: string
  moduleId: string
}): Promise<{ id: string; success: true }> {
  // SDK v0.2.8 does not expose client.modules.archive()
  // Call the documented REST endpoint directly:
  // POST /api/v1/workspaces/{slug}/projects/{project_id}/modules/{module_id}/archive/
  const url = `${params.baseUrl}/api/v1/workspaces/${params.workspaceSlug}/projects/${params.planeProjectId}/modules/${params.moduleId}/archive/`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'X-API-Key': params.apiKey },
  })

  if (!response.ok) {
    throw new Error(`Archive module failed: ${response.status} ${response.statusText}`)
  }

  return { id: params.moduleId, success: true }
}

// Inverse for unarchive-project:
// DELETE /api/v1/workspaces/{slug}/projects/{project_id}/modules/{module_id}/unarchive/
```

### Required storage

The team-to-project mapping must be stored. One option:

```sql
-- Extend user_config or add a dedicated table
CREATE TABLE linear_team_plane_project (
  user_id        INTEGER NOT NULL,
  linear_team_id TEXT    NOT NULL,
  plane_project_id TEXT  NOT NULL,
  PRIMARY KEY (user_id, linear_team_id)
);
```

At runtime, resolution looks like:

```typescript
function getPlaneProjectId(userId: number, linearTeamId: string): string | null {
  const row = db
    .query('SELECT plane_project_id FROM linear_team_plane_project WHERE user_id=? AND linear_team_id=?')
    .get(userId, linearTeamId)
  return row?.plane_project_id ?? null
}
```

---

## 8. Open Questions

1. **Multi-team Linear Projects**: If a Linear Project spans Team A and Team B, does it get two Modules (one in each Plane Project) or only one? The simplest approach is to pick the first/primary team, but this loses secondary team association.
2. **SDK upgrade path**: When @makeplane/plane-node-sdk exposes `client.modules.archive()`, the raw fetch call in `archive-project` can be replaced. Pin a TODO comment with the SDK issue tracker reference.
3. **Plane Project provisioning**: Who creates the "parent" Plane Projects? Options:
   - Auto-create on first `create-project` call if `plane_project_id` is missing
   - Require the user to manually configure the mapping via `/set` command
   - Mirror `list-teams` from Linear to auto-provision Plane Projects
4. **Archived modules visibility**: Plane lists archived modules separately (via `GET .../modules/?archived=true`). Verify SDK exposes this or plan a second raw HTTP call for `list-projects` when showing historical projects.
