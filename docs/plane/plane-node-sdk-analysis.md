# Plane Node SDK - Complete API Analysis

**Repository**: https://github.com/makeplane/plane-node-sdk  
**Version**: v0.2.8 (latest as of analysis)  
**Analysis Date**: March 10, 2026

## Overview

The Plane Node SDK is a TypeScript SDK for the Plane API (plane.so), providing type-safe interfaces for project management operations. It uses a centralized client pattern with resource-based API organization.

## Installation

```bash
npm install @makeplane/plane-node-sdk
```

## Client Initialization

```typescript
import { PlaneClient } from '@makeplane/plane-node-sdk'

const client = new PlaneClient({
  apiKey: 'your-api-key',
  // OR
  accessToken: 'your-access-token',
  // Optional
  baseUrl: 'https://api.plane.so', // default
  enableLogging: false, // default
})
```

---

## Core Models

### BaseModel

All entities extend this base model:

```typescript
interface BaseModel {
  id: string
  created_at: Date
  updated_at: Date
  deleted_at?: Date
  created_by: string
  updated_by?: string
  external_source?: string
  external_id?: string
}
```

### PaginatedResponse<T>

Standard pagination wrapper:

```typescript
interface PaginatedResponse<T> {
  grouped_by?: string
  sub_grouped_by?: string
  total_count: number
  next_cursor?: string
  prev_cursor?: string
  next_page_results?: boolean
  prev_page_results?: boolean
  count: number
  total_pages: number
  total_results: number
  extra_stats?: any
  results: T[]
}
```

### Common Enums

```typescript
type PriorityEnum = 'urgent' | 'high' | 'medium' | 'low' | 'none'
type AccessEnum = 'INTERNAL' | 'EXTERNAL'
type GroupEnum = 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled' | 'triage'
type PropertyType = 'TEXT' | 'DECIMAL' | 'OPTION' | 'BOOLEAN' | 'DATETIME' | 'RELATION'
type PropertyRelationType = 'USER' | 'ISSUE'
```

---

## API Resources

### 1. WorkItems (Issues/Tasks)

**Access**: `client.workItems`

#### Model: WorkItem

```typescript
interface WorkItemBase extends BaseModel {
  name: string;
  sequence_id: number;
  description_html?: string;
  project: string;
  labels?: string[];
  assignees?: string[];
  type?: string;
  estimate_point?: string;
  state?: string;
  parent?: string;
  is_draft?: boolean;
  archived_at?: string;
  completed_at?: string;
  sort_order?: number;
  target_date?: string; // YYYY-MM-DD
  start_date?: string; // YYYY-MM-DD
  priority?: PriorityEnum;
  description_stripped?: string;
  description_binary?: string;
}

// Expandable fields: type, module, labels, assignees, state, project
type WorkItem<Expanded extends WorkItemExpandableFieldName = never> = ...

interface CreateWorkItem {
  name: string;
  description_html?: string;
  state?: string;
  assignees?: string[];
  labels?: string[];
  parent?: string;
  estimate_point?: string;
  type?: string;
  module?: string;
  target_date?: string;
  start_date?: string;
  priority?: PriorityEnum;
}

interface UpdateWorkItem {
  name?: string;
  description_html?: string;
  state?: string;
  assignees?: string[];
  labels?: string[];
  parent?: string;
  estimate_point?: string;
  type?: string;
  module?: string;
  target_date?: string;
  start_date?: string;
  priority?: PriorityEnum;
}
```

#### Methods

```typescript
// Create a work item
await client.workItems.create(
  workspaceSlug: string,
  projectId: string,
  data: CreateWorkItem
): Promise<WorkItem>

// Retrieve by ID (with optional expansion)
await client.workItems.retrieve(
  workspaceSlug: string,
  projectId: string,
  workItemId: string,
  expand?: WorkItemExpandableFieldName[]
): Promise<WorkItem>

// Retrieve by identifier (e.g., "PROJ-123")
await client.workItems.retrieveByIdentifier(
  workspaceSlug: string,
  identifier: string,
  expand?: WorkItemExpandableFieldName[]
): Promise<WorkItem>

// Update a work item
await client.workItems.update(
  workspaceSlug: string,
  projectId: string,
  workItemId: string,
  data: UpdateWorkItem
): Promise<WorkItem>

// Delete a work item
await client.workItems.delete(
  workspaceSlug: string,
  projectId: string,
  workItemId: string
): Promise<void>

// List work items
await client.workItems.list(
  workspaceSlug: string,
  projectId: string,
  params?: {
    project?: string;
    state?: string;
    assignee?: string;
    limit?: number;
    offset?: number;
  }
): Promise<PaginatedResponse<WorkItem>>

// Search work items
await client.workItems.search(
  workspaceSlug: string,
  query: string,
  projectId?: string,
  params?: any
): Promise<WorkItemSearch>

// Advanced search with filters
await client.workItems.advancedSearch(
  workspaceSlug: string,
  data: {
    query?: string;
    filters?: AdvancedSearchFilter; // supports and/or groups
    limit?: number;
  }
): Promise<AdvancedSearchResult[]>
```

#### Sub-resources

##### Comments

**Access**: `client.workItems.comments`

```typescript
// Create comment
await client.workItems.comments.create(
  workspaceSlug: string,
  projectId: string,
  workItemId: string,
  data: {
    comment_html?: string;
    comment_json?: any;
    access?: AccessEnum;
    external_source?: string;
    external_id?: string;
  }
): Promise<WorkItemComment>

// List comments
await client.workItems.comments.list(
  workspaceSlug: string,
  projectId: string,
  workItemId: string,
  params?: { limit?: number; offset?: number }
): Promise<PaginatedResponse<WorkItemComment>>

// Retrieve comment
await client.workItems.comments.retrieve(
  workspaceSlug: string,
  projectId: string,
  workItemId: string,
  commentId: string
): Promise<WorkItemComment>

// Update comment
await client.workItems.comments.update(
  workspaceSlug: string,
  projectId: string,
  workItemId: string,
  commentId: string,
  data: WorkItemCommentUpdateRequest
): Promise<WorkItemComment>

// Delete comment
await client.workItems.comments.delete(
  workspaceSlug: string,
  projectId: string,
  workItemId: string,
  commentId: string
): Promise<void>
```

##### Relations

**Access**: `client.workItems.relations`

```typescript
type RelationType =
  | "blocking"
  | "blocked_by"
  | "duplicate"
  | "relates_to"
  | "start_before"
  | "start_after"
  | "finish_before"
  | "finish_after";

// Create relation
await client.workItems.relations.create(
  workspaceSlug: string,
  projectId: string,
  workItemId: string,
  data: {
    relation_type: RelationType;
    issues: string[]; // Array of work item IDs
  }
): Promise<void>

// List relations
await client.workItems.relations.list(
  workspaceSlug: string,
  projectId: string,
  workItemId: string
): Promise<{
  blocking: string[];
  blocked_by: string[];
  duplicate: string[];
  relates_to: string[];
  start_after: string[];
  start_before: string[];
  finish_after: string[];
  finish_before: string[];
}>

// Delete relation
await client.workItems.relations.delete(
  workspaceSlug: string,
  projectId: string,
  workItemId: string,
  data: { related_issue: string }
): Promise<void>
```

##### Attachments, Activities, WorkLogs

**Access**: `client.workItems.attachments`, `client.workItems.activities`, `client.workItems.workLogs`

---

### 2. Projects

**Access**: `client.projects`

#### Model: Project

```typescript
interface Project extends BaseModel {
  name: string
  identifier?: string // Auto-generated if not provided
  description: string
  total_members: number
  total_cycles: number
  total_modules: number
  is_member: boolean
  member_role: number
  is_deployed: boolean
  cover_image_url: null
  network?: number
  emoji?: null
  icon_prop?: null
  module_view: boolean
  cycle_view: boolean
  issue_views_view: boolean
  page_view: boolean
  intake_view: boolean
  is_time_tracking_enabled?: boolean
  is_issue_type_enabled?: boolean
  guest_view_all_features: boolean
  cover_image?: string
  archive_in: number
  close_in: number
  archived_at?: Date
  timezone: string
  workspace: string
  default_assignee: null
  project_lead: null
  cover_image_asset: null
  estimate: null
  default_state: null
}
```

#### Methods

```typescript
// Create project
await client.projects.create(
  workspaceSlug: string,
  data: {
    name: string;
    identifier?: string; // Auto-generated from name if omitted
    description?: string;
    // ... other optional fields
  }
): Promise<Project>

// Retrieve project
await client.projects.retrieve(
  workspaceSlug: string,
  projectId: string
): Promise<Project>

// Update project
await client.projects.update(
  workspaceSlug: string,
  projectId: string,
  data: Partial<Project>
): Promise<Project>

// Delete project
await client.projects.delete(
  workspaceSlug: string,
  projectId: string
): Promise<void>

// List projects
await client.projects.list(
  workspaceSlug: string,
  params?: { limit?: number; offset?: number }
): Promise<PaginatedResponse<Project>>

// Get project members
await client.projects.getMembers(
  workspaceSlug: string,
  projectId: string
): Promise<User[]>

// Get/Update project features
await client.projects.retrieveFeatures(
  workspaceSlug: string,
  projectId: string
): Promise<ProjectFeatures>

await client.projects.updateFeatures(
  workspaceSlug: string,
  projectId: string,
  data: UpdateProjectFeatures
): Promise<ProjectFeatures>
```

---

### 3. States (Workflow States)

**Access**: `client.states`

#### Model: State

```typescript
interface State {
  id: string
  name: string
  description?: string
  color: string
  sequence?: number
  group?: GroupEnum // "backlog" | "unstarted" | "started" | "completed" | "cancelled" | "triage"
  is_triage?: boolean
  default?: boolean
  project?: string
  workspace?: string
  external_source?: string
  external_id?: string
  created_at: string
  updated_at: string
  deleted_at: string
  created_by: string
  updated_by: string
}
```

#### Methods

```typescript
// Create state
await client.states.create(
  workspaceSlug: string,
  projectId: string,
  data: {
    name: string;
    color: string;
    description?: string;
    sequence?: number;
    group?: GroupEnum;
    is_triage?: boolean;
    default?: boolean;
    external_source?: string;
    external_id?: string;
  }
): Promise<State>

// List/Retrieve/Update/Delete follow same pattern as other resources
```

---

### 4. Labels

**Access**: `client.labels`

#### Model: Label

```typescript
interface Label {
  id?: string
  name: string
  description?: string
  color?: string
  sort_order?: number
  external_source?: string
  external_id?: string
  created_at?: string
  updated_at?: string
  deleted_at?: string
  created_by?: string
  updated_by?: string
  workspace?: string
  project?: string
  parent?: string
}
```

#### Methods

```typescript
// Standard CRUD operations
await client.labels.create(workspaceSlug, projectId, data)
await client.labels.retrieve(workspaceSlug, projectId, labelId)
await client.labels.update(workspaceSlug, projectId, labelId, data)
await client.labels.delete(workspaceSlug, projectId, labelId)
await client.labels.list(workspaceSlug, projectId, params?)
```

---

### 5. Modules

**Access**: `client.modules`

#### Model: Module

```typescript
interface Module extends BaseModel {
  name: string
  description?: string
  description_text?: any
  description_html?: any
  start_date?: string // YYYY-MM-DD
  target_date?: string // YYYY-MM-DD
  status?: ModuleStatusEnum
  view_props?: any
  sort_order?: number
}
```

#### Methods

```typescript
// Standard CRUD
await client.modules.create(workspaceSlug, projectId, data)
await client.modules.retrieve(workspaceSlug, projectId, moduleId)
await client.modules.update(workspaceSlug, projectId, moduleId, data)
await client.modules.delete(workspaceSlug, projectId, moduleId)
await client.modules.list(workspaceSlug, projectId, params?)

// Module-specific operations
await client.modules.listWorkItemsInModule(
  workspaceSlug: string,
  projectId: string,
  moduleId: string,
  params?: any
): Promise<PaginatedResponse<WorkItem>>

await client.modules.addWorkItemsToModule(
  workspaceSlug: string,
  projectId: string,
  moduleId: string,
  workItemIds: string[]
): Promise<void>

await client.modules.removeWorkItemFromModule(
  workspaceSlug: string,
  projectId: string,
  moduleId: string,
  workItemId: string
): Promise<void>
```

---

### 6. Cycles (Sprints)

**Access**: `client.cycles`

#### Model: Cycle

```typescript
interface Cycle extends BaseModel {
  name: string
  description?: string
  start_date?: string // YYYY-MM-DD
  end_date?: string // YYYY-MM-DD
  view_props?: any
  sort_order?: number
  progress_snapshot?: any
  archived_at?: string
  logo_props?: any
  timezone?: TimezoneEnum
  version?: number
  project: string
  workspace: string
  owned_by: string
}
```

#### Methods

```typescript
// Standard CRUD
await client.cycles.create(workspaceSlug, projectId, data)
await client.cycles.retrieve(workspaceSlug, projectId, cycleId)
await client.cycles.update(workspaceSlug, projectId, cycleId, data)
await client.cycles.delete(workspaceSlug, projectId, cycleId)
await client.cycles.list(workspaceSlug, projectId)

// Cycle-specific operations
await client.cycles.listWorkItemsInCycle(
  workspaceSlug: string,
  projectId: string,
  cycleId: string,
  params?: any
): Promise<PaginatedResponse<WorkItem>>

await client.cycles.addWorkItemsToCycle(
  workspaceSlug: string,
  projectId: string,
  cycleId: string,
  workItemIds: string[]
): Promise<void>

await client.cycles.archive(workspaceSlug, projectId, cycleId)
await client.cycles.unArchive(workspaceSlug, projectId, cycleId)
await client.cycles.listArchived(workspaceSlug, projectId, params?)
```

---

### 7. Milestones

**Access**: `client.milestones`

#### Model: Milestone

```typescript
interface Milestone extends BaseModel {
  title: string
  target_date?: string // YYYY-MM-DD
  project: string
  workspace: string
}

interface CreateMilestoneRequest {
  title: string
  target_date?: string // YYYY-MM-DD
  external_source?: string
  external_id?: string
}
```

---

### 8. Users & Members

**Access**: `client.users`, `client.members`

#### Model: User

```typescript
interface User {
  id?: string
  first_name?: string
  last_name?: string
  email?: string
  avatar?: string
  avatar_url?: string
  display_name?: string
}
```

---

### 9. Additional Resources

- **Epics**: `client.epics` - Epic management
- **Initiatives**: `client.initiatives` - Initiative tracking
- **Intake**: `client.intake` - Intake form management
- **Pages**: `client.pages` - Documentation pages
- **Customers**: `client.customers` - Customer management
- **Links**: `client.links` - Work item links/attachments
- **Stickies**: `client.stickies` - Sticky notes
- **Teamspaces**: `client.teamspaces` - Team workspace management
- **Workspace**: `client.workspace` - Workspace-level operations
- **WorkItemTypes**: `client.workItemTypes` - Custom work item types
- **WorkItemProperties**: `client.workItemProperties` - Custom properties
- **AgentRuns**: `client.agentRuns` - Agent execution tracking

---

## Common Patterns

### Resource Path Structure

All API calls follow this pattern:

```
/api/v1/workspaces/{workspaceSlug}/projects/{projectId}/{resource}/{id}/
```

### Authentication

The SDK supports two authentication methods:

1. **API Key**: Pass `apiKey` in config
2. **Access Token**: Pass `accessToken` in config

Headers are automatically set by `BaseResource`:

- `X-Api-Key` (if using apiKey)
- `Authorization: Bearer <token>` (if using accessToken)

### Error Handling

All API methods throw `HttpError` on failure, which includes:

- HTTP status code
- Error message
- Request/response details

### Expandable Fields

Some resources (like WorkItem) support field expansion to reduce API calls:

```typescript
const issue = await client.workItems.retrieve('my-workspace', 'project-id', 'issue-id', [
  'labels',
  'assignees',
  'state',
])
// Returns WorkItem with full label/assignee/state objects instead of IDs
```

---

## Key Differences from Linear API

1. **Terminology**:
   - Linear "Issue" → Plane "WorkItem"
   - Linear "Team" → Plane "Project"
   - Linear "Workspace" → Plane "Workspace"

2. **Identifiers**:
   - Plane uses `workspaceSlug` + `projectId` for scoping
   - Supports both ID-based and identifier-based lookup (e.g., "PROJ-123")

3. **Relations**:
   - Plane supports 8 relation types (blocking, blocked_by, duplicate, relates_to, start_before/after, finish_before/after)
   - Linear only has blocks/blocked_by/duplicate/relates_to

4. **Structure**:
   - Plane has nested API resources (e.g., `workItems.comments`, `workItems.relations`)
   - More granular organization with Modules, Cycles, Milestones

5. **Dates**:
   - Plane uses ISO date strings (YYYY-MM-DD)
   - Linear uses ISO 8601 datetime strings

---

## Migration Considerations

### From Linear to Plane

| Linear Concept | Plane Equivalent | Notes                         |
| -------------- | ---------------- | ----------------------------- |
| Issue          | WorkItem         | Core task/issue entity        |
| Team           | Project          | Project scoping               |
| IssueLabel     | Label            | Same concept                  |
| WorkflowState  | State            | Workflow states               |
| Project        | Module           | Feature grouping (different!) |
| Cycle          | Cycle            | Sprint/iteration              |
| Comment        | WorkItemComment  | Issue comments                |
| IssueRelation  | WorkItemRelation | Issue relationships           |
| Priority       | Priority         | Same enum values              |
| Attachment     | Attachment       | File attachments              |

### API Structure Mapping

**Linear Pattern**:

```typescript
await linearClient.issue.create(teamId, data)
await linearClient.issueComment.create(issueId, data)
```

**Plane Pattern**:

```typescript
await planeClient.workItems.create(workspaceSlug, projectId, data)
await planeClient.workItems.comments.create(workspaceSlug, projectId, workItemId, data)
```

---

## Testing

The SDK includes comprehensive test coverage. Environment variables required:

- `TEST_WORKSPACE_SLUG`
- `TEST_PROJECT_ID`
- `TEST_USER_ID`
- `TEST_WORK_ITEM_ID`
- `TEST_CUSTOMER_ID`

---

## Complete Model List

1. AgentRun
2. Attachment
3. Comment (WorkItemComment)
4. Customer
5. Cycle
6. Epic
7. Initiative
8. InitiativeLabel
9. Intake
10. Label
11. Link
12. Milestone
13. Module
14. OAuth
15. Page
16. Project
17. ProjectFeatures
18. State
19. Sticky
20. Teamspace
21. User
22. WorkItem
23. WorkItemProperty
24. WorkItemRelation
25. WorkItemType
26. WorkLog
27. WorkspaceFeatures

---

## External References

- **SDK Repository**: https://github.com/makeplane/plane-node-sdk
- **Plane Documentation**: https://docs.plane.so
- **Plane API**: https://api.plane.so
- **NPM Package**: https://www.npmjs.com/package/@makeplane/plane-node-sdk
