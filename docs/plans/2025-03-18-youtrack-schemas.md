# YouTrack Provider Schemas Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create Zod schema definitions for YouTrack REST API request/response validation, mirroring the Kaneo provider structure.

**Architecture:** Create 50+ schema files in `src/providers/youtrack/schemas/` following Kaneo patterns: request/response schemas per endpoint, reusable entity schemas (Issue, Project, Comment, Tag), enum validation, and type inference exports. Uses YouTrack's `$type` discriminators and custom field patterns.

**Tech Stack:** TypeScript, Zod v4

---

## Research Summary

### YouTrack vs Kaneo Field Mappings

| Kaneo         | YouTrack                | Notes                        |
| ------------- | ----------------------- | ---------------------------- |
| `task`        | `issue`                 | Primary entity               |
| `title`       | `summary`               | Issue title                  |
| `description` | `description`           | Same field name              |
| `id`          | `id`                    | Same - database ID           |
| `number`      | `idReadable`            | Human-readable ID (PROJ-123) |
| `project`     | `project`               | Same concept                 |
| `status`      | custom field `State`    | Enum custom field            |
| `priority`    | custom field `Priority` | Enum custom field            |
| `dueDate`     | custom field            | Simple custom field          |
| `label`       | `tag`                   | Same concept                 |
| `column`      | `agile` column          | Board column                 |
| `comment`     | `comment`               | Same concept                 |
| `assignee`    | custom field `Assignee` | User custom field            |
| `createdAt`   | `created`               | Timestamp in ms              |
| `updatedAt`   | `updated`               | Timestamp in ms              |

### Key YouTrack Patterns

1. **All entities have `$type` discriminator** - Required in requests
2. **Custom fields are complex** - Each has `$type`, `name`, and `value`
3. **Pagination uses `$skip` and `$top`** (max 42)
4. **Query language for searching** - `for: me #Unresolved project: MyProject`
5. **Fields parameter** - Controls which attributes are returned
6. **Issue links** - Relates, Depend, Duplicate, Subtask

---

## Task 1: Create Directory Structure

**Files:**

- Create: `src/providers/youtrack/schemas/` (directory)

**Step 1: Create schemas directory**

```bash
mkdir -p src/providers/youtrack/schemas
```

**Step 2: Commit**

```bash
git add src/providers/youtrack/
git commit -m "chore: create youtrack provider schemas directory"
```

---

## Task 2: Create Base Types and Enums

**Files:**

- Create: `src/providers/youtrack/schemas/common.ts`
- Test: `tests/providers/youtrack/schemas/common.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/providers/youtrack/schemas/common.test.ts
import { describe, expect, test } from 'bun:test'
import {
  IssueStateEnum,
  IssuePriorityEnum,
  LinkTypeEnum,
  BaseEntitySchema,
  TimestampSchema,
} from '../../../src/providers/youtrack/schemas/common.js'

describe('YouTrack common schemas', () => {
  test('IssueStateEnum validates valid states', () => {
    expect(IssueStateEnum.parse('Open')).toBe('Open')
    expect(IssueStateEnum.parse('In Progress')).toBe('In Progress')
    expect(IssueStateEnum.parse('Resolved')).toBe('Resolved')
    expect(IssueStateEnum.parse('Closed')).toBe('Closed')
  })

  test('IssuePriorityEnum validates valid priorities', () => {
    expect(IssuePriorityEnum.parse('Critical')).toBe('Critical')
    expect(IssuePriorityEnum.parse('Major')).toBe('Major')
    expect(IssuePriorityEnum.parse('Normal')).toBe('Normal')
    expect(IssuePriorityEnum.parse('Minor')).toBe('Minor')
  })

  test('LinkTypeEnum validates valid link types', () => {
    expect(LinkTypeEnum.parse('Relates')).toBe('Relates')
    expect(LinkTypeEnum.parse('Depend')).toBe('Depend')
    expect(LinkTypeEnum.parse('Duplicate')).toBe('Duplicate')
    expect(LinkTypeEnum.parse('Subtask')).toBe('Subtask')
  })

  test('BaseEntitySchema validates required fields', () => {
    const valid = {
      id: '123',
      $type: 'Issue',
    }
    expect(() => BaseEntitySchema.parse(valid)).not.toThrow()
  })

  test('TimestampSchema accepts number timestamps', () => {
    expect(TimestampSchema.parse(1700000000000)).toBe(1700000000000)
    expect(() => TimestampSchema.parse('not a number')).toThrow()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/providers/youtrack/schemas/common.test.ts`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// src/providers/youtrack/schemas/common.ts
import { z } from 'zod'

export const IssueStateEnum = z.enum([
  'Open',
  'In Progress',
  'Wait for Reply',
  'Reopened',
  'Resolved',
  'Closed',
  'Canceled',
])

export const IssuePriorityEnum = z.enum(['Show-stopper', 'Critical', 'Major', 'Normal', 'Minor', 'Cosmetic'])

export const LinkTypeEnum = z.enum(['Relates', 'Depend', 'Duplicate', 'Subtask'])

export const BaseEntitySchema = z.object({
  id: z.string(),
  $type: z.string(),
})

export const TimestampSchema = z.number().int().positive()

export type IssueState = z.infer<typeof IssueStateEnum>
export type IssuePriority = z.infer<typeof IssuePriorityEnum>
export type LinkType = z.infer<typeof LinkTypeEnum>
export type BaseEntity = z.infer<typeof BaseEntitySchema>
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/providers/youtrack/schemas/common.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/providers/youtrack/schemas/common.test.ts src/providers/youtrack/schemas/common.ts
git commit -m "feat(youtrack): add common schemas and enums"
```

---

## Task 3: Create User Schemas

**Files:**

- Create: `src/providers/youtrack/schemas/user.ts`
- Test: `tests/providers/youtrack/schemas/user.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/providers/youtrack/schemas/user.test.ts
import { describe, expect, test } from 'bun:test'
import { UserSchema, UserReferenceSchema } from '../../../src/providers/youtrack/schemas/user.js'

describe('User schemas', () => {
  test('UserSchema validates full user', () => {
    const valid = {
      id: '1-1',
      $type: 'User',
      login: 'john.doe',
      fullName: 'John Doe',
      email: 'john@example.com',
      created: 1700000000000,
    }
    const result = UserSchema.parse(valid)
    expect(result.login).toBe('john.doe')
    expect(result.fullName).toBe('John Doe')
  })

  test('UserReferenceSchema validates reference', () => {
    const valid = {
      id: '1-1',
      $type: 'User',
      login: 'john.doe',
    }
    const result = UserReferenceSchema.parse(valid)
    expect(result.login).toBe('john.doe')
  })

  test('UserSchema requires login', () => {
    const invalid = {
      id: '1-1',
      $type: 'User',
    }
    expect(() => UserSchema.parse(invalid)).toThrow()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/providers/youtrack/schemas/user.test.ts`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// src/providers/youtrack/schemas/user.ts
import { z } from 'zod'
import { BaseEntitySchema, TimestampSchema } from './common.js'

export const UserSchema = BaseEntitySchema.extend({
  login: z.string(),
  fullName: z.string(),
  email: z.string().optional(),
  avatarUrl: z.string().optional(),
  created: TimestampSchema.optional(),
  lastAccess: TimestampSchema.optional(),
})

export const UserReferenceSchema = BaseEntitySchema.extend({
  login: z.string(),
})

export type User = z.infer<typeof UserSchema>
export type UserReference = z.infer<typeof UserReferenceSchema>
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/providers/youtrack/schemas/user.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/providers/youtrack/schemas/user.test.ts src/providers/youtrack/schemas/user.ts
git commit -m "feat(youtrack): add user schemas"
```

---

## Task 4: Create Project Schemas

**Files:**

- Create: `src/providers/youtrack/schemas/project.ts`
- Test: `tests/providers/youtrack/schemas/project.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/providers/youtrack/schemas/project.test.ts
import { describe, expect, test } from 'bun:test'
import {
  ProjectSchema,
  CreateProjectRequestSchema,
  CreateProjectResponseSchema,
  ListProjectsRequestSchema,
  ListProjectsResponseSchema,
  GetProjectRequestSchema,
  GetProjectResponseSchema,
  UpdateProjectRequestSchema,
  UpdateProjectResponseSchema,
  DeleteProjectRequestSchema,
} from '../../../src/providers/youtrack/schemas/project.js'

describe('Project schemas', () => {
  test('ProjectSchema validates project', () => {
    const valid = {
      id: '0-0',
      $type: 'Project',
      name: 'My Project',
      shortName: 'MP',
      description: 'Description',
      archived: false,
    }
    const result = ProjectSchema.parse(valid)
    expect(result.shortName).toBe('MP')
  })

  test('CreateProjectRequestSchema validates request', () => {
    const valid = {
      name: 'New Project',
      shortName: 'NP',
    }
    const result = CreateProjectRequestSchema.parse(valid)
    expect(result.shortName).toBe('NP')
  })

  test('CreateProjectResponseSchema validates response', () => {
    const valid = {
      id: '0-0',
      $type: 'Project',
      name: 'New Project',
      shortName: 'NP',
    }
    expect(() => CreateProjectResponseSchema.parse(valid)).not.toThrow()
  })

  test('ListProjectsRequestSchema validates with query', () => {
    const valid = {
      fields: 'id,name,shortName',
    }
    const result = ListProjectsRequestSchema.parse(valid)
    expect(result.fields).toBe('id,name,shortName')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/providers/youtrack/schemas/project.test.ts`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// src/providers/youtrack/schemas/project.ts
import { z } from 'zod'
import { BaseEntitySchema, TimestampSchema } from './common.js'
import { UserSchema } from './user.js'

export const ProjectSchema = BaseEntitySchema.extend({
  name: z.string(),
  shortName: z.string(),
  description: z.string().optional(),
  archived: z.boolean().optional(),
  leader: z.lazy(() => UserSchema).optional(),
  createdBy: z.lazy(() => UserSchema).optional(),
  created: TimestampSchema.optional(),
})

export const CreateProjectRequestSchema = z.object({
  name: z.string(),
  shortName: z.string(),
  description: z.string().optional(),
  leader: z.object({ id: z.string() }).optional(),
})

export const CreateProjectResponseSchema = ProjectSchema

export const ListProjectsQuerySchema = z.object({
  fields: z.string().optional(),
  $skip: z.number().optional(),
  $top: z.number().optional(),
})

export const ListProjectsRequestSchema = z.object({
  query: ListProjectsQuerySchema,
})

export const ListProjectsResponseSchema = z.array(ProjectSchema)

export const GetProjectPathSchema = z.object({
  projectId: z.string(),
})

export const GetProjectQuerySchema = z.object({
  fields: z.string().optional(),
})

export const GetProjectRequestSchema = z.object({
  path: GetProjectPathSchema,
  query: GetProjectQuerySchema.optional(),
})

export const GetProjectResponseSchema = ProjectSchema

export const UpdateProjectPathSchema = z.object({
  projectId: z.string(),
})

export const UpdateProjectBodySchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  archived: z.boolean().optional(),
  leader: z.object({ id: z.string() }).optional(),
})

export const UpdateProjectRequestSchema = z.object({
  path: UpdateProjectPathSchema,
  body: UpdateProjectBodySchema,
})

export const UpdateProjectResponseSchema = ProjectSchema

export const DeleteProjectPathSchema = z.object({
  projectId: z.string(),
})

export const DeleteProjectRequestSchema = z.object({
  path: DeleteProjectPathSchema,
})

export type Project = z.infer<typeof ProjectSchema>
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>
export type CreateProjectResponse = z.infer<typeof CreateProjectResponseSchema>
export type ListProjectsRequest = z.infer<typeof ListProjectsRequestSchema>
export type ListProjectsResponse = z.infer<typeof ListProjectsResponseSchema>
export type GetProjectRequest = z.infer<typeof GetProjectRequestSchema>
export type GetProjectResponse = z.infer<typeof GetProjectResponseSchema>
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequestSchema>
export type UpdateProjectResponse = z.infer<typeof UpdateProjectResponseSchema>
export type DeleteProjectRequest = z.infer<typeof DeleteProjectRequestSchema>
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/providers/youtrack/schemas/project.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/providers/youtrack/schemas/project.test.ts src/providers/youtrack/schemas/project.ts
git commit -m "feat(youtrack): add project schemas"
```

---

## Task 5: Create Custom Field Schemas

**Files:**

- Create: `src/providers/youtrack/schemas/custom-fields.ts`
- Test: `tests/providers/youtrack/schemas/custom-fields.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/providers/youtrack/schemas/custom-fields.test.ts
import { describe, expect, test } from 'bun:test'
import {
  SingleEnumIssueCustomFieldSchema,
  SingleUserIssueCustomFieldSchema,
  TextIssueCustomFieldSchema,
  SimpleIssueCustomFieldSchema,
  CustomFieldValueSchema,
} from '../../../src/providers/youtrack/schemas/custom-fields.js'

describe('Custom field schemas', () => {
  test('SingleEnumIssueCustomFieldSchema validates enum field', () => {
    const valid = {
      name: 'Priority',
      $type: 'SingleEnumIssueCustomField',
      value: { name: 'Critical', $type: 'EnumBundleElement' },
    }
    const result = SingleEnumIssueCustomFieldSchema.parse(valid)
    expect(result.name).toBe('Priority')
    expect(result.value.name).toBe('Critical')
  })

  test('SingleUserIssueCustomFieldSchema validates assignee field', () => {
    const valid = {
      name: 'Assignee',
      $type: 'SingleUserIssueCustomField',
      value: { id: '1-1', $type: 'User', login: 'john.doe' },
    }
    const result = SingleUserIssueCustomFieldSchema.parse(valid)
    expect(result.value.login).toBe('john.doe')
  })

  test('TextIssueCustomFieldSchema validates text field', () => {
    const valid = {
      name: 'Description',
      $type: 'TextIssueCustomField',
      value: { text: 'Description text', $type: 'TextFieldValue' },
    }
    const result = TextIssueCustomFieldSchema.parse(valid)
    expect(result.value.text).toBe('Description text')
  })

  test('SimpleIssueCustomFieldSchema validates date field', () => {
    const valid = {
      name: 'Due Date',
      $type: 'SimpleIssueCustomField',
      value: 1700000000000,
    }
    const result = SimpleIssueCustomFieldSchema.parse(valid)
    expect(result.value).toBe(1700000000000)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/providers/youtrack/schemas/custom-fields.test.ts`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// src/providers/youtrack/schemas/custom-fields.ts
import { z } from 'zod'
import { BaseEntitySchema } from './common.js'
import { UserSchema } from './user.js'

export const EnumBundleElementSchema = BaseEntitySchema.extend({
  name: z.string(),
  ordinal: z.number().optional(),
})

export const TextFieldValueSchema = z.object({
  $type: z.literal('TextFieldValue'),
  text: z.string(),
})

export const SingleEnumIssueCustomFieldSchema = z.object({
  $type: z.literal('SingleEnumIssueCustomField'),
  name: z.string(),
  value: EnumBundleElementSchema,
})

export const MultiEnumIssueCustomFieldSchema = z.object({
  $type: z.literal('MultiEnumIssueCustomField'),
  name: z.string(),
  value: z.array(EnumBundleElementSchema),
})

export const SingleUserIssueCustomFieldSchema = z.object({
  $type: z.literal('SingleUserIssueCustomField'),
  name: z.string(),
  value: z.lazy(() => UserSchema).optional(),
})

export const MultiUserIssueCustomFieldSchema = z.object({
  $type: z.literal('MultiUserIssueCustomField'),
  name: z.string(),
  value: z.array(z.lazy(() => UserSchema)).optional(),
})

export const TextIssueCustomFieldSchema = z.object({
  $type: z.literal('TextIssueCustomField'),
  name: z.string(),
  value: TextFieldValueSchema,
})

export const SimpleIssueCustomFieldSchema = z.object({
  $type: z.literal('SimpleIssueCustomField'),
  name: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
})

export const CustomFieldValueSchema = z.union([
  SingleEnumIssueCustomFieldSchema,
  MultiEnumIssueCustomFieldSchema,
  SingleUserIssueCustomFieldSchema,
  MultiUserIssueCustomFieldSchema,
  TextIssueCustomFieldSchema,
  SimpleIssueCustomFieldSchema,
])

export const ProjectCustomFieldSchema = z.object({
  $type: z.string(),
  name: z.string(),
  fieldType: z.object({
    $type: z.string(),
    id: z.string(),
  }),
})

export type EnumBundleElement = z.infer<typeof EnumBundleElementSchema>
export type TextFieldValue = z.infer<typeof TextFieldValueSchema>
export type SingleEnumIssueCustomField = z.infer<typeof SingleEnumIssueCustomFieldSchema>
export type MultiEnumIssueCustomField = z.infer<typeof MultiEnumIssueCustomFieldSchema>
export type SingleUserIssueCustomField = z.infer<typeof SingleUserIssueCustomFieldSchema>
export type MultiUserIssueCustomField = z.infer<typeof MultiUserIssueCustomFieldSchema>
export type TextIssueCustomField = z.infer<typeof TextIssueCustomFieldSchema>
export type SimpleIssueCustomField = z.infer<typeof SimpleIssueCustomFieldSchema>
export type CustomFieldValue = z.infer<typeof CustomFieldValueSchema>
export type ProjectCustomField = z.infer<typeof ProjectCustomFieldSchema>
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/providers/youtrack/schemas/custom-fields.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/providers/youtrack/schemas/custom-fields.test.ts src/providers/youtrack/schemas/custom-fields.ts
git commit -m "feat(youtrack): add custom field schemas"
```

---

## Task 6: Create Tag/Label Schemas

**Files:**

- Create: `src/providers/youtrack/schemas/tag.ts`
- Test: `tests/providers/youtrack/schemas/tag.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/providers/youtrack/schemas/tag.test.ts
import { describe, expect, test } from 'bun:test'
import {
  TagSchema,
  CreateTagRequestSchema,
  ListTagsRequestSchema,
  AddTagToIssueRequestSchema,
  RemoveTagFromIssueRequestSchema,
} from '../../../src/providers/youtrack/schemas/tag.js'

describe('Tag schemas', () => {
  test('TagSchema validates tag', () => {
    const valid = {
      id: '0-0',
      $type: 'IssueTag',
      name: 'Bug',
      color: { id: '0-0', $type: 'FieldStyle', background: '#FF0000' },
    }
    const result = TagSchema.parse(valid)
    expect(result.name).toBe('Bug')
  })

  test('CreateTagRequestSchema validates request', () => {
    const valid = {
      name: 'Feature',
      color: { background: '#00FF00' },
    }
    const result = CreateTagRequestSchema.parse(valid)
    expect(result.name).toBe('Feature')
  })

  test('AddTagToIssueRequestSchema validates request', () => {
    const valid = {
      path: { issueId: 'PROJ-123' },
      body: { id: '0-0', $type: 'IssueTag' },
    }
    const result = AddTagToIssueRequestSchema.parse(valid)
    expect(result.path.issueId).toBe('PROJ-123')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/providers/youtrack/schemas/tag.test.ts`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// src/providers/youtrack/schemas/tag.ts
import { z } from 'zod'
import { BaseEntitySchema } from './common.js'

export const FieldStyleSchema = z.object({
  $type: z.string().optional(),
  id: z.string().optional(),
  background: z.string(),
  foreground: z.string().optional(),
})

export const TagSchema = BaseEntitySchema.extend({
  name: z.string(),
  color: FieldStyleSchema.optional(),
  untagOnResolve: z.boolean().optional(),
  owner: z.object({ id: z.string() }).optional(),
})

export const CreateTagRequestSchema = z.object({
  name: z.string(),
  color: FieldStyleSchema.optional(),
  untagOnResolve: z.boolean().optional(),
})

export const CreateTagResponseSchema = TagSchema

export const ListTagsQuerySchema = z.object({
  fields: z.string().optional(),
  $skip: z.number().optional(),
  $top: z.number().optional(),
})

export const ListTagsRequestSchema = z.object({
  query: ListTagsQuerySchema,
})

export const ListTagsResponseSchema = z.array(TagSchema)

export const AddTagToIssuePathSchema = z.object({
  issueId: z.string(),
})

export const AddTagToIssueBodySchema = z.object({
  id: z.string(),
  $type: z.string().optional(),
})

export const AddTagToIssueRequestSchema = z.object({
  path: AddTagToIssuePathSchema,
  body: AddTagToIssueBodySchema,
})

export const RemoveTagFromIssuePathSchema = z.object({
  issueId: z.string(),
  tagId: z.string(),
})

export const RemoveTagFromIssueRequestSchema = z.object({
  path: RemoveTagFromIssuePathSchema,
})

export const UpdateTagPathSchema = z.object({
  tagId: z.string(),
})

export const UpdateTagBodySchema = z.object({
  name: z.string().optional(),
  color: FieldStyleSchema.optional(),
  untagOnResolve: z.boolean().optional(),
})

export const UpdateTagRequestSchema = z.object({
  path: UpdateTagPathSchema,
  body: UpdateTagBodySchema,
})

export const UpdateTagResponseSchema = TagSchema

export const DeleteTagPathSchema = z.object({
  tagId: z.string(),
})

export const DeleteTagRequestSchema = z.object({
  path: DeleteTagPathSchema,
})

export type Tag = z.infer<typeof TagSchema>
export type FieldStyle = z.infer<typeof FieldStyleSchema>
export type CreateTagRequest = z.infer<typeof CreateTagRequestSchema>
export type CreateTagResponse = z.infer<typeof CreateTagResponseSchema>
export type ListTagsRequest = z.infer<typeof ListTagsRequestSchema>
export type ListTagsResponse = z.infer<typeof ListTagsResponseSchema>
export type AddTagToIssueRequest = z.infer<typeof AddTagToIssueRequestSchema>
export type RemoveTagFromIssueRequest = z.infer<typeof RemoveTagFromIssueRequestSchema>
export type UpdateTagRequest = z.infer<typeof UpdateTagRequestSchema>
export type UpdateTagResponse = z.infer<typeof UpdateTagResponseSchema>
export type DeleteTagRequest = z.infer<typeof DeleteTagRequestSchema>
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/providers/youtrack/schemas/tag.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/providers/youtrack/schemas/tag.test.ts src/providers/youtrack/schemas/tag.ts
git commit -m "feat(youtrack): add tag schemas"
```

---

## Task 7: Create Issue Schemas

**Files:**

- Create: `src/providers/youtrack/schemas/issue.ts`
- Test: `tests/providers/youtrack/schemas/issue.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/providers/youtrack/schemas/issue.test.ts
import { describe, expect, test } from 'bun:test'
import {
  IssueSchema,
  CreateIssueRequestSchema,
  ListIssuesRequestSchema,
  GetIssueRequestSchema,
  UpdateIssueRequestSchema,
  DeleteIssueRequestSchema,
  SearchIssuesRequestSchema,
} from '../../../src/providers/youtrack/schemas/issue.js'

describe('Issue schemas', () => {
  test('IssueSchema validates full issue', () => {
    const valid = {
      id: '0-0',
      $type: 'Issue',
      idReadable: 'PROJ-123',
      summary: 'Test Issue',
      description: 'Description text',
      created: 1700000000000,
      updated: 1700000000001,
      project: { id: '0-0', $type: 'Project' },
      customFields: [],
      tags: [],
    }
    const result = IssueSchema.parse(valid)
    expect(result.idReadable).toBe('PROJ-123')
    expect(result.summary).toBe('Test Issue')
  })

  test('CreateIssueRequestSchema validates request', () => {
    const valid = {
      summary: 'New Issue',
      description: 'Description',
      project: { id: '0-0' },
      customFields: [
        {
          name: 'Priority',
          $type: 'SingleEnumIssueCustomField',
          value: { name: 'Major' },
        },
      ],
    }
    const result = CreateIssueRequestSchema.parse(valid)
    expect(result.summary).toBe('New Issue')
  })

  test('SearchIssuesRequestSchema validates query', () => {
    const valid = {
      query: 'for: me #Unresolved',
      fields: 'id,idReadable,summary',
    }
    const result = SearchIssuesRequestSchema.parse(valid)
    expect(result.query).toBe('for: me #Unresolved')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/providers/youtrack/schemas/issue.test.ts`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// src/providers/youtrack/schemas/issue.ts
import { z } from 'zod'
import { BaseEntitySchema, TimestampSchema } from './common.js'
import { UserSchema } from './user.js'
import { ProjectSchema } from './project.js'
import { CustomFieldValueSchema } from './custom-fields.js'
import { TagSchema } from './tag.js'

export const IssueSchema = BaseEntitySchema.extend({
  idReadable: z.string(),
  summary: z.string(),
  description: z.string().optional(),
  project: z.lazy(() => ProjectSchema),
  reporter: z.lazy(() => UserSchema).optional(),
  updater: z.lazy(() => UserSchema).optional(),
  created: TimestampSchema,
  updated: TimestampSchema,
  resolved: TimestampSchema.optional(),
  customFields: z.array(CustomFieldValueSchema),
  tags: z.array(z.lazy(() => TagSchema)).optional(),
  commentsCount: z.number().optional(),
  votes: z.number().optional(),
})

export const CreateIssueRequestSchema = z.object({
  summary: z.string(),
  description: z.string().optional(),
  project: z.object({ id: z.string() }),
  customFields: z
    .array(
      z.object({
        name: z.string(),
        $type: z.string(),
        value: z.unknown(),
      }),
    )
    .optional(),
  tags: z.array(z.object({ id: z.string() })).optional(),
})

export const CreateIssueResponseSchema = IssueSchema

export const ListIssuesPathSchema = z.object({
  projectId: z.string(),
})

export const ListIssuesQuerySchema = z.object({
  fields: z.string().optional(),
  $skip: z.number().optional(),
  $top: z.number().optional(),
})

export const ListIssuesRequestSchema = z.object({
  path: ListIssuesPathSchema,
  query: ListIssuesQuerySchema.optional(),
})

export const ListIssuesResponseSchema = z.array(IssueSchema)

export const SearchIssuesQuerySchema = z.object({
  query: z.string().optional(),
  fields: z.string().optional(),
  $skip: z.number().optional(),
  $top: z.number().optional(),
})

export const SearchIssuesRequestSchema = z.object({
  query: SearchIssuesQuerySchema,
})

export const SearchIssuesResponseSchema = z.array(IssueSchema)

export const GetIssuePathSchema = z.object({
  issueId: z.string(),
})

export const GetIssueQuerySchema = z.object({
  fields: z.string().optional(),
})

export const GetIssueRequestSchema = z.object({
  path: GetIssuePathSchema,
  query: GetIssueQuerySchema.optional(),
})

export const GetIssueResponseSchema = IssueSchema

export const UpdateIssuePathSchema = z.object({
  issueId: z.string(),
})

export const UpdateIssueBodySchema = z.object({
  summary: z.string().optional(),
  description: z.string().optional(),
  customFields: z
    .array(
      z.object({
        name: z.string(),
        $type: z.string(),
        value: z.unknown(),
      }),
    )
    .optional(),
})

export const UpdateIssueRequestSchema = z.object({
  path: UpdateIssuePathSchema,
  body: UpdateIssueBodySchema,
})

export const UpdateIssueResponseSchema = IssueSchema

export const DeleteIssuePathSchema = z.object({
  issueId: z.string(),
})

export const DeleteIssueRequestSchema = z.object({
  path: DeleteIssuePathSchema,
})

export type Issue = z.infer<typeof IssueSchema>
export type CreateIssueRequest = z.infer<typeof CreateIssueRequestSchema>
export type CreateIssueResponse = z.infer<typeof CreateIssueResponseSchema>
export type ListIssuesRequest = z.infer<typeof ListIssuesRequestSchema>
export type ListIssuesResponse = z.infer<typeof ListIssuesResponseSchema>
export type SearchIssuesRequest = z.infer<typeof SearchIssuesRequestSchema>
export type SearchIssuesResponse = z.infer<typeof SearchIssuesResponseSchema>
export type GetIssueRequest = z.infer<typeof GetIssueRequestSchema>
export type GetIssueResponse = z.infer<typeof GetIssueResponseSchema>
export type UpdateIssueRequest = z.infer<typeof UpdateIssueRequestSchema>
export type UpdateIssueResponse = z.infer<typeof UpdateIssueResponseSchema>
export type DeleteIssueRequest = z.infer<typeof DeleteIssueRequestSchema>
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/providers/youtrack/schemas/issue.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/providers/youtrack/schemas/issue.test.ts src/providers/youtrack/schemas/issue.ts
git commit -m "feat(youtrack): add issue schemas"
```

---

## Task 8: Create Comment Schemas

**Files:**

- Create: `src/providers/youtrack/schemas/comment.ts`
- Test: `tests/providers/youtrack/schemas/comment.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/providers/youtrack/schemas/comment.test.ts
import { describe, expect, test } from 'bun:test'
import {
  CommentSchema,
  CreateCommentRequestSchema,
  ListCommentsRequestSchema,
  UpdateCommentRequestSchema,
  DeleteCommentRequestSchema,
} from '../../../src/providers/youtrack/schemas/comment.js'

describe('Comment schemas', () => {
  test('CommentSchema validates comment', () => {
    const valid = {
      id: '0-0',
      $type: 'IssueComment',
      text: 'This is a comment',
      author: { id: '1-1', $type: 'User', login: 'john.doe' },
      created: 1700000000000,
    }
    const result = CommentSchema.parse(valid)
    expect(result.text).toBe('This is a comment')
  })

  test('CreateCommentRequestSchema validates request', () => {
    const valid = {
      path: { issueId: 'PROJ-123' },
      body: { text: 'New comment' },
    }
    const result = CreateCommentRequestSchema.parse(valid)
    expect(result.body.text).toBe('New comment')
  })

  test('UpdateCommentRequestSchema validates request', () => {
    const valid = {
      path: { issueId: 'PROJ-123', commentId: '0-0' },
      body: { text: 'Updated text' },
    }
    const result = UpdateCommentRequestSchema.parse(valid)
    expect(result.body.text).toBe('Updated text')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/providers/youtrack/schemas/comment.test.ts`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// src/providers/youtrack/schemas/comment.ts
import { z } from 'zod'
import { BaseEntitySchema, TimestampSchema } from './common.js'
import { UserSchema } from './user.js'

export const CommentSchema = BaseEntitySchema.extend({
  text: z.string(),
  textPreview: z.string().optional(),
  author: z.lazy(() => UserSchema),
  created: TimestampSchema,
  updated: TimestampSchema.optional(),
  deleted: z.boolean().optional(),
  pinned: z.boolean().optional(),
})

export const ListCommentsPathSchema = z.object({
  issueId: z.string(),
})

export const ListCommentsQuerySchema = z.object({
  fields: z.string().optional(),
})

export const ListCommentsRequestSchema = z.object({
  path: ListCommentsPathSchema,
  query: ListCommentsQuerySchema.optional(),
})

export const ListCommentsResponseSchema = z.array(CommentSchema)

export const CreateCommentPathSchema = z.object({
  issueId: z.string(),
})

export const CreateCommentBodySchema = z.object({
  text: z.string(),
})

export const CreateCommentRequestSchema = z.object({
  path: CreateCommentPathSchema,
  body: CreateCommentBodySchema,
})

export const CreateCommentResponseSchema = CommentSchema

export const UpdateCommentPathSchema = z.object({
  issueId: z.string(),
  commentId: z.string(),
})

export const UpdateCommentBodySchema = z.object({
  text: z.string(),
})

export const UpdateCommentRequestSchema = z.object({
  path: UpdateCommentPathSchema,
  body: UpdateCommentBodySchema,
})

export const UpdateCommentResponseSchema = CommentSchema

export const DeleteCommentPathSchema = z.object({
  issueId: z.string(),
  commentId: z.string(),
})

export const DeleteCommentRequestSchema = z.object({
  path: DeleteCommentPathSchema,
})

export type Comment = z.infer<typeof CommentSchema>
export type ListCommentsRequest = z.infer<typeof ListCommentsRequestSchema>
export type ListCommentsResponse = z.infer<typeof ListCommentsResponseSchema>
export type CreateCommentRequest = z.infer<typeof CreateCommentRequestSchema>
export type CreateCommentResponse = z.infer<typeof CreateCommentResponseSchema>
export type UpdateCommentRequest = z.infer<typeof UpdateCommentRequestSchema>
export type UpdateCommentResponse = z.infer<typeof UpdateCommentResponseSchema>
export type DeleteCommentRequest = z.infer<typeof DeleteCommentRequestSchema>
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/providers/youtrack/schemas/comment.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/providers/youtrack/schemas/comment.test.ts src/providers/youtrack/schemas/comment.ts
git commit -m "feat(youtrack): add comment schemas"
```

---

## Task 9: Create Issue Link/Relation Schemas

**Files:**

- Create: `src/providers/youtrack/schemas/issue-link.ts`
- Test: `tests/providers/youtrack/schemas/issue-link.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/providers/youtrack/schemas/issue-link.test.ts
import { describe, expect, test } from 'bun:test'
import {
  IssueLinkSchema,
  IssueLinkTypeSchema,
  CreateIssueLinkRequestSchema,
  RemoveIssueLinkRequestSchema,
} from '../../../src/providers/youtrack/schemas/issue-link.js'

describe('Issue link schemas', () => {
  test('IssueLinkSchema validates link', () => {
    const valid = {
      id: '0-0',
      $type: 'IssueLink',
      type: {
        id: '0-0',
        $type: 'IssueLinkType',
        name: 'Relates',
        directed: false,
      },
      issues: [{ id: '0-0', $type: 'Issue', idReadable: 'PROJ-456' }],
    }
    const result = IssueLinkSchema.parse(valid)
    expect(result.type.name).toBe('Relates')
  })

  test('CreateIssueLinkRequestSchema validates request', () => {
    const valid = {
      path: { issueId: 'PROJ-123' },
      body: {
        type: 'Relates',
        issues: [{ idReadable: 'PROJ-456' }],
      },
    }
    const result = CreateIssueLinkRequestSchema.parse(valid)
    expect(result.body.type).toBe('Relates')
  })

  test('RemoveIssueLinkRequestSchema validates request', () => {
    const valid = {
      path: { issueId: 'PROJ-123', linkId: '0-0' },
    }
    const result = RemoveIssueLinkRequestSchema.parse(valid)
    expect(result.path.issueId).toBe('PROJ-123')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/providers/youtrack/schemas/issue-link.test.ts`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// src/providers/youtrack/schemas/issue-link.ts
import { z } from 'zod'
import { BaseEntitySchema } from './common.js'
import { LinkTypeEnum } from './common.js'
import { IssueSchema } from './issue.js'

export const IssueLinkTypeSchema = BaseEntitySchema.extend({
  name: LinkTypeEnum,
  directed: z.boolean(),
  aggregation: z.boolean().optional(),
  localizedName: z.string().optional(),
  localizedSourceToTarget: z.string().optional(),
  localizedTargetToSource: z.string().optional(),
})

export const IssueLinkSchema = BaseEntitySchema.extend({
  type: IssueLinkTypeSchema,
  issues: z.array(z.lazy(() => IssueSchema)),
})

export const ListIssueLinksPathSchema = z.object({
  issueId: z.string(),
})

export const ListIssueLinksQuerySchema = z.object({
  fields: z.string().optional(),
})

export const ListIssueLinksRequestSchema = z.object({
  path: ListIssueLinksPathSchema,
  query: ListIssueLinksQuerySchema.optional(),
})

export const ListIssueLinksResponseSchema = z.array(IssueLinkSchema)

export const CreateIssueLinkPathSchema = z.object({
  issueId: z.string(),
})

export const CreateIssueLinkBodySchema = z.object({
  type: z.string(),
  issues: z.array(
    z.object({
      id: z.string().optional(),
      idReadable: z.string().optional(),
    }),
  ),
})

export const CreateIssueLinkRequestSchema = z.object({
  path: CreateIssueLinkPathSchema,
  body: CreateIssueLinkBodySchema,
})

export const CreateIssueLinkResponseSchema = IssueLinkSchema

export const RemoveIssueLinkPathSchema = z.object({
  issueId: z.string(),
  linkId: z.string(),
})

export const RemoveIssueLinkRequestSchema = z.object({
  path: RemoveIssueLinkPathSchema,
})

export type IssueLinkType = z.infer<typeof IssueLinkTypeSchema>
export type IssueLink = z.infer<typeof IssueLinkSchema>
export type ListIssueLinksRequest = z.infer<typeof ListIssueLinksRequestSchema>
export type ListIssueLinksResponse = z.infer<typeof ListIssueLinksResponseSchema>
export type CreateIssueLinkRequest = z.infer<typeof CreateIssueLinkRequestSchema>
export type CreateIssueLinkResponse = z.infer<typeof CreateIssueLinkResponseSchema>
export type RemoveIssueLinkRequest = z.infer<typeof RemoveIssueLinkRequestSchema>
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/providers/youtrack/schemas/issue-link.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/providers/youtrack/schemas/issue-link.test.ts src/providers/youtrack/schemas/issue-link.ts
git commit -m "feat(youtrack): add issue link schemas"
```

---

## Task 10: Create Agile Board/Column Schemas

**Files:**

- Create: `src/providers/youtrack/schemas/agile.ts`
- Test: `tests/providers/youtrack/schemas/agile.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/providers/youtrack/schemas/agile.test.ts
import { describe, expect, test } from 'bun:test'
import {
  AgileBoardSchema,
  AgileColumnSchema,
  ListAgileBoardsRequestSchema,
  ListAgileColumnsRequestSchema,
} from '../../../src/providers/youtrack/schemas/agile.js'

describe('Agile board schemas', () => {
  test('AgileBoardSchema validates board', () => {
    const valid = {
      id: '0-0',
      $type: 'Agile',
      name: 'Sprint Board',
      projects: [{ id: '0-0', $type: 'Project' }],
    }
    const result = AgileBoardSchema.parse(valid)
    expect(result.name).toBe('Sprint Board')
  })

  test('AgileColumnSchema validates column', () => {
    const valid = {
      id: '0-0',
      $type: 'AgileColumn',
      name: 'In Progress',
      ordinal: 1,
    }
    const result = AgileColumnSchema.parse(valid)
    expect(result.name).toBe('In Progress')
  })

  test('ListAgileBoardsRequestSchema validates query', () => {
    const valid = {
      fields: 'id,name,projects',
    }
    const result = ListAgileBoardsRequestSchema.parse(valid)
    expect(result.fields).toBe('id,name,projects')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/providers/youtrack/schemas/agile.test.ts`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// src/providers/youtrack/schemas/agile.ts
import { z } from 'zod'
import { BaseEntitySchema } from './common.js'
import { ProjectSchema } from './project.js'

export const AgileColumnSchema = BaseEntitySchema.extend({
  name: z.string(),
  ordinal: z.number(),
  issues: z.array(z.object({ id: z.string() })).optional(),
})

export const AgileBoardSchema = BaseEntitySchema.extend({
  name: z.string(),
  projects: z.array(z.lazy(() => ProjectSchema)),
  columns: z.array(AgileColumnSchema).optional(),
  sprints: z.array(z.object({ id: z.string() })).optional(),
  owner: z.object({ id: z.string() }).optional(),
})

export const ListAgileBoardsQuerySchema = z.object({
  fields: z.string().optional(),
  $skip: z.number().optional(),
  $top: z.number().optional(),
})

export const ListAgileBoardsRequestSchema = z.object({
  query: ListAgileBoardsQuerySchema,
})

export const ListAgileBoardsResponseSchema = z.array(AgileBoardSchema)

export const GetAgileBoardPathSchema = z.object({
  boardId: z.string(),
})

export const GetAgileBoardQuerySchema = z.object({
  fields: z.string().optional(),
})

export const GetAgileBoardRequestSchema = z.object({
  path: GetAgileBoardPathSchema,
  query: GetAgileBoardQuerySchema.optional(),
})

export const GetAgileBoardResponseSchema = AgileBoardSchema

export const ListAgileColumnsPathSchema = z.object({
  boardId: z.string(),
})

export const ListAgileColumnsRequestSchema = z.object({
  path: ListAgileColumnsPathSchema,
})

export const ListAgileColumnsResponseSchema = z.array(AgileColumnSchema)

export const UpdateAgileColumnPathSchema = z.object({
  boardId: z.string(),
  columnId: z.string(),
})

export const UpdateAgileColumnBodySchema = z.object({
  name: z.string().optional(),
  ordinal: z.number().optional(),
})

export const UpdateAgileColumnRequestSchema = z.object({
  path: UpdateAgileColumnPathSchema,
  body: UpdateAgileColumnBodySchema,
})

export const UpdateAgileColumnResponseSchema = AgileColumnSchema

export type AgileColumn = z.infer<typeof AgileColumnSchema>
export type AgileBoard = z.infer<typeof AgileBoardSchema>
export type ListAgileBoardsRequest = z.infer<typeof ListAgileBoardsRequestSchema>
export type ListAgileBoardsResponse = z.infer<typeof ListAgileBoardsResponseSchema>
export type GetAgileBoardRequest = z.infer<typeof GetAgileBoardRequestSchema>
export type GetAgileBoardResponse = z.infer<typeof GetAgileBoardResponseSchema>
export type ListAgileColumnsRequest = z.infer<typeof ListAgileColumnsRequestSchema>
export type ListAgileColumnsResponse = z.infer<typeof ListAgileColumnsResponseSchema>
export type UpdateAgileColumnRequest = z.infer<typeof UpdateAgileColumnRequestSchema>
export type UpdateAgileColumnResponse = z.infer<typeof UpdateAgileColumnResponseSchema>
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/providers/youtrack/schemas/agile.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/providers/youtrack/schemas/agile.test.ts src/providers/youtrack/schemas/agile.ts
git commit -m "feat(youtrack): add agile board schemas"
```

---

## Task 11: Create Index File

**Files:**

- Create: `src/providers/youtrack/schemas/index.ts`
- Test: `tests/providers/youtrack/schemas/index.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/providers/youtrack/schemas/index.test.ts
import { describe, expect, test } from 'bun:test'
import * as schemas from '../../../src/providers/youtrack/schemas/index.js'

describe('Schema index exports', () => {
  test('exports all common schemas', () => {
    expect(schemas.IssueStateEnum).toBeDefined()
    expect(schemas.IssuePriorityEnum).toBeDefined()
    expect(schemas.LinkTypeEnum).toBeDefined()
    expect(schemas.BaseEntitySchema).toBeDefined()
    expect(schemas.TimestampSchema).toBeDefined()
  })

  test('exports all user schemas', () => {
    expect(schemas.UserSchema).toBeDefined()
    expect(schemas.UserReferenceSchema).toBeDefined()
  })

  test('exports all project schemas', () => {
    expect(schemas.ProjectSchema).toBeDefined()
    expect(schemas.CreateProjectRequestSchema).toBeDefined()
    expect(schemas.ListProjectsRequestSchema).toBeDefined()
  })

  test('exports all custom field schemas', () => {
    expect(schemas.SingleEnumIssueCustomFieldSchema).toBeDefined()
    expect(schemas.SingleUserIssueCustomFieldSchema).toBeDefined()
    expect(schemas.CustomFieldValueSchema).toBeDefined()
  })

  test('exports all tag schemas', () => {
    expect(schemas.TagSchema).toBeDefined()
    expect(schemas.CreateTagRequestSchema).toBeDefined()
    expect(schemas.AddTagToIssueRequestSchema).toBeDefined()
  })

  test('exports all issue schemas', () => {
    expect(schemas.IssueSchema).toBeDefined()
    expect(schemas.CreateIssueRequestSchema).toBeDefined()
    expect(schemas.SearchIssuesRequestSchema).toBeDefined()
  })

  test('exports all comment schemas', () => {
    expect(schemas.CommentSchema).toBeDefined()
    expect(schemas.CreateCommentRequestSchema).toBeDefined()
    expect(schemas.ListCommentsRequestSchema).toBeDefined()
  })

  test('exports all issue link schemas', () => {
    expect(schemas.IssueLinkSchema).toBeDefined()
    expect(schemas.IssueLinkTypeSchema).toBeDefined()
    expect(schemas.CreateIssueLinkRequestSchema).toBeDefined()
  })

  test('exports all agile schemas', () => {
    expect(schemas.AgileBoardSchema).toBeDefined()
    expect(schemas.AgileColumnSchema).toBeDefined()
    expect(schemas.ListAgileBoardsRequestSchema).toBeDefined()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/providers/youtrack/schemas/index.test.ts`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// src/providers/youtrack/schemas/index.ts
export * from './common.js'
export * from './user.js'
export * from './project.js'
export * from './custom-fields.js'
export * from './tag.js'
export * from './issue.js'
export * from './comment.js'
export * from './issue-link.js'
export * from './agile.js'
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/providers/youtrack/schemas/index.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/providers/youtrack/schemas/index.test.ts src/providers/youtrack/schemas/index.ts
git commit -m "feat(youtrack): add schema index file"
```

---

## Task 12: Run Full Test Suite and Lint

**Step 1: Run all YouTrack schema tests**

Run: `bun test tests/providers/youtrack/`
Expected: All tests pass

**Step 2: Run lint**

Run: `bun run lint`
Expected: No errors

**Step 3: Run format check**

Run: `bun run format`
Expected: Files formatted

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(youtrack): complete schema definitions for YouTrack REST API

- Add common enums (IssueState, IssuePriority, LinkType)
- Add user and project schemas with CRUD operations
- Add custom field schemas with $type discriminators
- Add tag/label schemas
- Add issue schemas with search and CRUD
- Add comment schemas with CRUD operations
- Add issue link/relation schemas
- Add agile board/column schemas
- Create comprehensive test coverage for all schemas
- Export all schemas from index.ts"
```

---

## File Summary

### Schema Files (11 files)

| File                                              | Description                                                                         |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/providers/youtrack/schemas/common.ts`        | Base enums (IssueState, IssuePriority, LinkType), BaseEntitySchema, TimestampSchema |
| `src/providers/youtrack/schemas/user.ts`          | UserSchema, UserReferenceSchema                                                     |
| `src/providers/youtrack/schemas/project.ts`       | ProjectSchema, CRUD schemas for projects                                            |
| `src/providers/youtrack/schemas/custom-fields.ts` | All custom field types with $type discriminators                                    |
| `src/providers/youtrack/schemas/tag.ts`           | TagSchema, CRUD schemas for tags                                                    |
| `src/providers/youtrack/schemas/issue.ts`         | IssueSchema, CRUD + search schemas for issues                                       |
| `src/providers/youtrack/schemas/comment.ts`       | CommentSchema, CRUD schemas for comments                                            |
| `src/providers/youtrack/schemas/issue-link.ts`    | IssueLinkSchema, IssueLinkTypeSchema, link management                               |
| `src/providers/youtrack/schemas/agile.ts`         | AgileBoardSchema, AgileColumnSchema for boards                                      |
| `src/providers/youtrack/schemas/index.ts`         | Re-exports all schemas                                                              |

### Test Files (11 files)

| File                                                     | Coverage             |
| -------------------------------------------------------- | -------------------- |
| `tests/providers/youtrack/schemas/common.test.ts`        | Enums and base types |
| `tests/providers/youtrack/schemas/user.test.ts`          | User schemas         |
| `tests/providers/youtrack/schemas/project.test.ts`       | Project schemas      |
| `tests/providers/youtrack/schemas/custom-fields.test.ts` | Custom field schemas |
| `tests/providers/youtrack/schemas/tag.test.ts`           | Tag schemas          |
| `tests/providers/youtrack/schemas/issue.test.ts`         | Issue schemas        |
| `tests/providers/youtrack/schemas/comment.test.ts`       | Comment schemas      |
| `tests/providers/youtrack/schemas/issue-link.test.ts`    | Issue link schemas   |
| `tests/providers/youtrack/schemas/agile.test.ts`         | Agile board schemas  |
| `tests/providers/youtrack/schemas/index.test.ts`         | Index exports        |

---

## YouTrack API Endpoints Covered

### Issues

- POST /api/issues - Create issue
- GET /api/issues - Search issues
- GET /api/issues/{issueId} - Get issue
- POST /api/issues/{issueId} - Update issue
- DELETE /api/issues/{issueId} - Delete issue
- GET /api/admin/projects/{projectId}/issues - List project issues

### Projects

- GET /api/admin/projects - List projects
- GET /api/admin/projects/{projectId} - Get project
- POST /api/admin/projects - Create project
- POST /api/admin/projects/{projectId} - Update project

### Comments

- GET /api/issues/{issueId}/comments - List comments
- POST /api/issues/{issueId}/comments - Create comment
- POST /api/issues/{issueId}/comments/{commentId} - Update comment
- DELETE /api/issues/{issueId}/comments/{commentId} - Delete comment

### Tags

- GET /api/tags - List tags
- POST /api/tags - Create tag
- POST /api/tags/{tagId} - Update tag
- DELETE /api/tags/{tagId} - Delete tag
- Add/remove tags from issues

### Issue Links

- GET /api/issues/{issueId}/links - List links
- POST /api/issues/{issueId}/links - Create link
- DELETE /api/issues/{issueId}/links/{linkId} - Remove link

### Agile Boards

- GET /api/agiles - List boards
- GET /api/agiles/{boardId} - Get board
- Board column operations

---

## Schema Patterns Summary

1. **$type discriminator** - All YouTrack entities have `$type` field
2. **Custom fields with $type** - SingleEnumIssueCustomField, SingleUserIssueCustomField, etc.
3. **Request schemas** - Combine path, body, and query as separate schemas
4. **Response schemas** - Usually reuse entity schemas
5. **Enum types** - IssueState, IssuePriority, LinkType for validation
6. **Timestamps** - Unix epoch milliseconds as numbers
7. **Lazy loading** - Use `z.lazy()` for circular references (Issue -> Project -> Issue)
8. **Pagination** - `$skip` and `$top` parameters
9. **Fields parameter** - Controls which attributes are returned
10. **Query language** - YouTrack query syntax for searching

---

## Key Differences from Kaneo

| Aspect        | Kaneo            | YouTrack                     |
| ------------- | ---------------- | ---------------------------- |
| Entity        | Task             | Issue                        |
| Title         | `title`          | `summary`                    |
| ID            | `id` (number)    | `id` (string) + `idReadable` |
| Status        | `status` field   | Custom field with `$type`    |
| Priority      | `priority` field | Custom field with `$type`    |
| Assignee      | `userId` field   | Custom field with `$type`    |
| Labels        | `label`          | `tag`                        |
| Columns       | `column`         | `agile` board columns        |
| Due date      | `dueDate`        | Custom field                 |
| Discriminator | None             | `$type` required             |
| Pagination    | `limit`/`offset` | `$skip`/`$top`               |
| Search        | Keyword          | Query language               |
