# YouTrack: Replace types.ts with Zod schemas

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Delete `src/providers/youtrack/types.ts` and replace its plain TypeScript interfaces with Zod schemas that also provide runtime validation of YouTrack API responses.

**Architecture:** Create `schemas/yt-types.ts` with production-oriented Zod schemas matching the actual API field queries (`ISSUE_FIELDS`, etc.). Update `ISSUE_FIELDS` in `constants.ts` to use `name`-based custom fields (simpler shape). Wire `.parse()` calls into every operation so API responses are validated at runtime, not just type-cast. Remove the `types.ts` file and the `ignoreFiles` entry in `knip.jsonc`.

**Tech Stack:** Zod v4, TypeScript, Bun test runner

---

## Background: shape mismatch

Currently `ISSUE_FIELDS` requests custom fields as:

```
customFields($type,id,projectCustomField($type,id,field($type,id,name)),value($type,name,login,isResolved))
```

And `mappers.ts` reads: `f.projectCustomField?.field?.name === fieldName`.

After this change, `ISSUE_FIELDS` will request:

```
customFields($type,name,value($type,name,login))
```

And the mapper will read: `f.name === fieldName`. This matches the shape of `CustomFieldValueSchema` already in `schemas/custom-fields.ts`.

---

### Task 1: Create `schemas/yt-types.ts`

**Files:**

- Create: `src/providers/youtrack/schemas/yt-types.ts`
- Modify: `src/providers/youtrack/schemas/index.ts`

**Step 1: Create the file**

```typescript
// src/providers/youtrack/schemas/yt-types.ts
import { z } from 'zod'

/**
 * Production-oriented Zod schemas that match what YouTrack API actually returns
 * for the field queries defined in constants.ts (ISSUE_FIELDS, COMMENT_FIELDS, etc.)
 *
 * These replace the plain TypeScript interfaces in types.ts.
 * The more detailed schemas in other files (IssueSchema, UserSchema, etc.) remain
 * for test-level validation.
 */

/** Custom field value: object with optional name/login, or a primitive. */
const YtCustomFieldValueSchema = z
  .union([z.object({ name: z.string().optional(), login: z.string().optional() }), z.string(), z.number(), z.boolean()])
  .nullable()
  .optional()

/**
 * Custom field as returned by `customFields($type,name,value($type,name,login))`.
 * Loose $type (any string) to handle unknown field types gracefully.
 */
export const YtCustomFieldSchema = z.object({
  $type: z.string(),
  name: z.string(),
  value: YtCustomFieldValueSchema,
})

/** Issue link as returned by `links(id,direction,linkType(name,...),issues(id,idReadable,summary))`. */
export const YtIssueLinkSchema = z.object({
  id: z.string().optional(),
  direction: z.string(),
  linkType: z
    .object({
      name: z.string().optional(),
      sourceToTarget: z.string().optional(),
      targetToSource: z.string().optional(),
    })
    .optional(),
  issues: z
    .array(
      z.object({
        id: z.string(),
        idReadable: z.string().optional(),
        summary: z.string().optional(),
      }),
    )
    .optional(),
})

/** Tag as returned by `tags(id,name,color(id,background))`. */
export const YtTagSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.object({ background: z.string().optional() }).optional(),
})

/** Full issue schema matching ISSUE_FIELDS query. */
export const YtIssueSchema = z.object({
  id: z.string(),
  idReadable: z.string().optional(),
  summary: z.string(),
  description: z.string().optional(),
  created: z.number().optional(),
  updated: z.number().optional(),
  resolved: z.number().nullable().optional(),
  project: z
    .object({
      id: z.string(),
      shortName: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
  customFields: z.array(YtCustomFieldSchema).optional(),
  tags: z.array(YtTagSchema).optional(),
  links: z.array(YtIssueLinkSchema).optional(),
})

/** Partial issue schema for relation lookup (fields: `id,links(...)`). */
export const YtIssueLinksSchema = z.object({
  id: z.string(),
  links: z.array(YtIssueLinkSchema).optional(),
})

/** Partial issue schema for tag/label reads (fields: `id,tags(id)`). */
export const YtIssueTagsSchema = z.object({
  tags: z.array(z.object({ id: z.string() })).optional(),
})

/** Comment schema matching COMMENT_FIELDS query. */
export const YtCommentSchema = z.object({
  id: z.string(),
  text: z.string(),
  author: z
    .object({
      login: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
  created: z.number().optional(),
})

/** Project schema matching PROJECT_FIELDS query. */
export const YtProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  shortName: z.string().optional(),
  description: z.string().optional(),
  archived: z.boolean().optional(),
})

/** Tag/label schema matching TAG_FIELDS query. */
export const YtLabelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.object({ background: z.string().optional() }).optional(),
})

// Inferred types — replace the plain interfaces in types.ts
export type YtIssue = z.infer<typeof YtIssueSchema>
export type YtComment = z.infer<typeof YtCommentSchema>
export type YtProject = z.infer<typeof YtProjectSchema>
export type YtTag = z.infer<typeof YtTagSchema>
export type YtLabel = z.infer<typeof YtLabelSchema>
export type YtIssueLinks = z.infer<typeof YtIssueLinksSchema>
export type YtIssueTags = z.infer<typeof YtIssueTagsSchema>
```

**Step 2: Add export to `schemas/index.ts`**

Append at the end of `src/providers/youtrack/schemas/index.ts`:

```typescript
export * from './yt-types.js'
```

**Step 3: Write tests**

```typescript
// tests/providers/youtrack/schemas/yt-types.test.ts
import { describe, expect, test } from 'bun:test'

import {
  YtIssueSchema,
  YtCommentSchema,
  YtProjectSchema,
  YtLabelSchema,
  YtCustomFieldSchema,
  YtIssueLinkSchema,
  YtIssueLinksSchema,
  YtIssueTagsSchema,
} from '../../../../src/providers/youtrack/schemas/yt-types.js'

describe('YtIssueSchema', () => {
  test('parses minimal issue', () => {
    const result = YtIssueSchema.parse({ id: '2-1', summary: 'Hello' })
    expect(result.id).toBe('2-1')
    expect(result.summary).toBe('Hello')
    expect(result.customFields).toBeUndefined()
  })

  test('parses issue with name-based custom fields', () => {
    const result = YtIssueSchema.parse({
      id: '2-1',
      summary: 'Hello',
      customFields: [
        { $type: 'SingleEnumIssueCustomField', name: 'Priority', value: { name: 'Normal' } },
        { $type: 'StateIssueCustomField', name: 'State', value: { name: 'Open' } },
        { $type: 'SingleUserIssueCustomField', name: 'Assignee', value: { login: 'john' } },
      ],
    })
    expect(result.customFields).toHaveLength(3)
    expect(result.customFields![0]!.name).toBe('Priority')
    expect(result.customFields![2]!.name).toBe('Assignee')
  })

  test('parses issue with links', () => {
    const result = YtIssueSchema.parse({
      id: '2-1',
      summary: 'Hello',
      links: [
        {
          direction: 'OUTWARD',
          linkType: { name: 'Depend' },
          issues: [{ id: '2-2', idReadable: 'TEST-2' }],
        },
      ],
    })
    expect(result.links).toHaveLength(1)
    expect(result.links![0]!.direction).toBe('OUTWARD')
  })

  test('allows unknown custom field $type', () => {
    const result = YtIssueSchema.parse({
      id: '2-1',
      summary: 'Hello',
      customFields: [{ $type: 'SomeFutureFieldType', name: 'X', value: null }],
    })
    expect(result.customFields![0]!.$type).toBe('SomeFutureFieldType')
  })

  test('parses null resolved timestamp', () => {
    const result = YtIssueSchema.parse({ id: '2-1', summary: 'Hello', resolved: null })
    expect(result.resolved).toBeNull()
  })
})

describe('YtCommentSchema', () => {
  test('parses comment', () => {
    const result = YtCommentSchema.parse({
      id: 'c-1',
      text: 'Hello world',
      author: { login: 'alice', name: 'Alice' },
      created: 1700000000000,
    })
    expect(result.id).toBe('c-1')
    expect(result.author?.name).toBe('Alice')
  })
})

describe('YtProjectSchema', () => {
  test('parses project', () => {
    const result = YtProjectSchema.parse({ id: 'p-1', name: 'My Project', shortName: 'MP' })
    expect(result.id).toBe('p-1')
  })
})

describe('YtLabelSchema', () => {
  test('parses label with color', () => {
    const result = YtLabelSchema.parse({ id: 't-1', name: 'bug', color: { background: '#ff0000' } })
    expect(result.color?.background).toBe('#ff0000')
  })

  test('parses label without color', () => {
    const result = YtLabelSchema.parse({ id: 't-2', name: 'feature' })
    expect(result.color).toBeUndefined()
  })
})

describe('YtIssueLinksSchema', () => {
  test('parses partial issue used for relation lookup', () => {
    const result = YtIssueLinksSchema.parse({
      id: '2-1',
      links: [{ direction: 'INWARD', linkType: { name: 'Depend' }, issues: [{ id: '2-2' }] }],
    })
    expect(result.links).toHaveLength(1)
  })
})

describe('YtIssueTagsSchema', () => {
  test('parses partial issue used for tag reads', () => {
    const result = YtIssueTagsSchema.parse({ tags: [{ id: 't-1' }, { id: 't-2' }] })
    expect(result.tags).toHaveLength(2)
  })
})
```

**Step 4: Run tests**

```bash
bun run test tests/providers/youtrack/schemas/yt-types.test.ts
```

Expected: all pass.

**Step 5: Commit**

```bash
git add src/providers/youtrack/schemas/yt-types.ts src/providers/youtrack/schemas/index.ts tests/providers/youtrack/schemas/yt-types.test.ts
git commit -m "feat(youtrack): add production-ready Zod schemas for API response types"
```

---

### Task 2: Update `ISSUE_FIELDS` to match schema shape

**Files:**

- Modify: `src/providers/youtrack/constants.ts`

The old custom fields query reads `projectCustomField.field.name` to get the field name. The new shape puts `name` directly on the custom field object, matching `YtCustomFieldSchema`.

**Step 1: Update `ISSUE_FIELDS` in `constants.ts`**

Change this line in `ISSUE_FIELDS`:

```typescript
// Before:
'customFields($type,id,projectCustomField($type,id,field($type,id,name)),value($type,name,login,isResolved))',
// After:
'customFields($type,name,value($type,name,login))',
```

The full updated constant:

```typescript
export const ISSUE_FIELDS = [
  'id',
  'idReadable',
  'summary',
  'description',
  'created',
  'updated',
  'resolved',
  'project(id,shortName,name)',
  'customFields($type,name,value($type,name,login))',
  'tags(id,name,color(id,background))',
  'links(id,direction,linkType(name,sourceToTarget,targetToSource),issues(id,idReadable,summary))',
].join(',')
```

**Step 2: Commit**

```bash
git add src/providers/youtrack/constants.ts
git commit -m "fix(youtrack): simplify ISSUE_FIELDS custom fields query to name-based shape"
```

---

### Task 3: Update `mappers.ts` to use schema types

**Files:**

- Modify: `src/providers/youtrack/mappers.ts`

The `getCustomFieldValue` function currently reads `f.projectCustomField?.field?.name` (old shape). With the new schema, custom fields have `name` directly on the object.

**Step 1: Update imports and `getCustomFieldValue`**

```typescript
// src/providers/youtrack/mappers.ts
import type { Comment, RelationType, Task, TaskListItem, TaskSearchResult } from '../types.js'
import type { YtComment, YtIssue } from './schemas/yt-types.js' // Changed import

const getCustomFieldValue = (issue: YtIssue, fieldName: string): string | undefined => {
  const cf = issue.customFields?.find((f) => f.name === fieldName) // Changed: was f.projectCustomField?.field?.name
  if (cf?.value === null || cf?.value === undefined) return undefined
  if (typeof cf.value !== 'object') return undefined // Guard: value is primitive, not name-bearing object
  return cf.value.name ?? cf.value.login
}
```

The rest of `mappers.ts` stays unchanged — `mapIssueToTask`, `mapIssueToListItem`, `mapIssueToSearchResult`, `mapComment`, `buildCustomFields` all still use `YtIssue` and `YtComment` from the new location.

**Step 2: Run existing tests**

```bash
bun run test tests/providers/youtrack/provider.test.ts
```

Expected: FAIL — mock responses in provider.test.ts still use the old custom field shape (`projectCustomField.field.name`).

**Step 3: Update mock responses in `provider.test.ts`**

In `tests/providers/youtrack/provider.test.ts`, two test cases have old-shaped custom fields. Change them:

`createTask` test mock (line ~62):

```typescript
// Before:
customFields: [
  {
    $type: 'SingleEnumIssueCustomField',
    projectCustomField: { field: { name: 'Priority' } },
    value: { name: 'Normal' },
  },
],
// After:
customFields: [
  { $type: 'SingleEnumIssueCustomField', name: 'Priority', value: { name: 'Normal' } },
],
```

`getTask` test mock (line ~106):

```typescript
// Before:
customFields: [
  {
    $type: 'StateIssueCustomField',
    projectCustomField: { field: { name: 'State' } },
    value: { name: 'Open' },
  },
],
// After:
customFields: [
  { $type: 'StateIssueCustomField', name: 'State', value: { name: 'Open' } },
],
```

**Step 4: Run tests again**

```bash
bun run test tests/providers/youtrack/provider.test.ts
```

Expected: still FAIL — `types.ts` still imported by operations; mappers haven't had `types.ts` removed yet.

We'll fix that in Task 4. For now move on.

**Step 5: Commit**

```bash
git add src/providers/youtrack/mappers.ts tests/providers/youtrack/provider.test.ts
git commit -m "fix(youtrack): update mappers to use name-based custom field lookup and schema types"
```

---

### Task 4: Wire Zod parsing into each operation file

**Files:**

- Modify: `src/providers/youtrack/operations/tasks.ts`
- Modify: `src/providers/youtrack/operations/comments.ts`
- Modify: `src/providers/youtrack/operations/projects.ts`
- Modify: `src/providers/youtrack/labels.ts`
- Modify: `src/providers/youtrack/relations.ts`

Replace `import type { YtXxx } from '../types.js'` with schema imports, and call `.parse()` on each API response.

**Step 1: Update `operations/tasks.ts`**

Replace the `YtIssue` import and all `youtrackFetch<YtIssue>` calls:

```typescript
// Remove:
import type { YtIssue } from '../types.js'

// Add:
import { YtIssueSchema } from '../schemas/yt-types.js'
import type { YtIssue } from '../schemas/yt-types.js'
```

For each fetch call, remove the generic type and add `.parse()`:

```typescript
// createYouTrackTask — before:
const issue = await youtrackFetch<YtIssue>(config, 'POST', '/api/issues', { ... })
// after:
const raw = await youtrackFetch(config, 'POST', '/api/issues', { ... })
const issue = YtIssueSchema.parse(raw)

// getYouTrackTask — before:
const issue = await youtrackFetch<YtIssue>(config, 'GET', `/api/issues/${taskId}`, { ... })
// after:
const raw = await youtrackFetch(config, 'GET', `/api/issues/${taskId}`, { ... })
const issue = YtIssueSchema.parse(raw)

// updateYouTrackTask — before:
const issue = await youtrackFetch<YtIssue>(config, 'POST', `/api/issues/${taskId}`, { ... })
// after:
const raw = await youtrackFetch(config, 'POST', `/api/issues/${taskId}`, { ... })
const issue = YtIssueSchema.parse(raw)

// listYouTrackTasks — before:
const issues = await youtrackFetch<YtIssue[]>(config, 'GET', '/api/issues', { ... })
// after:
const raw = await youtrackFetch(config, 'GET', '/api/issues', { ... })
const issues = YtIssueSchema.array().parse(raw)

// searchYouTrackTasks — before:
const issues = await youtrackFetch<YtIssue[]>(config, 'GET', '/api/issues', { ... })
// after:
const raw = await youtrackFetch(config, 'GET', '/api/issues', { ... })
const issues = YtIssueSchema.array().parse(raw)

// deleteYouTrackTask — no change needed (result is unused)
```

**Step 2: Update `operations/comments.ts`**

```typescript
// Remove:
import type { YtComment } from '../types.js'

// Add:
import { YtCommentSchema } from '../schemas/yt-types.js'
import type { YtComment } from '../schemas/yt-types.js'
```

```typescript
// addYouTrackComment:
const raw = await youtrackFetch(config, 'POST', `/api/issues/${taskId}/comments`, { ... })
const comment = YtCommentSchema.parse(raw)

// getYouTrackComments:
const raw = await youtrackFetch(config, 'GET', `/api/issues/${taskId}/comments`, { ... })
const comments = YtCommentSchema.array().parse(raw)

// updateYouTrackComment:
const raw = await youtrackFetch(config, 'POST', `/api/issues/${params.taskId}/comments/${params.commentId}`, { ... })
const comment = YtCommentSchema.parse(raw)

// removeYouTrackComment — no parse needed (result unused)
```

**Step 3: Update `operations/projects.ts`**

```typescript
// Remove:
import type { YtProject } from '../types.js'

// Add:
import { YtProjectSchema } from '../schemas/yt-types.js'
import type { YtProject } from '../schemas/yt-types.js'
```

```typescript
// getYouTrackProject:
const raw = await youtrackFetch(config, 'GET', `/api/admin/projects/${projectId}`, { ... })
const project = YtProjectSchema.parse(raw)

// listYouTrackProjects:
const raw = await youtrackFetch(config, 'GET', '/api/admin/projects', { ... })
const projects = YtProjectSchema.array().parse(raw)

// createYouTrackProject:
const raw = await youtrackFetch(config, 'POST', '/api/admin/projects', { ... })
const project = YtProjectSchema.parse(raw)

// updateYouTrackProject:
const raw = await youtrackFetch(config, 'POST', `/api/admin/projects/${projectId}`, { ... })
const project = YtProjectSchema.parse(raw)

// archiveYouTrackProject — no parse needed (result unused)
```

**Step 4: Update `labels.ts`**

```typescript
// Remove:
import type { YtTag } from './types.js'

// Add:
import { YtLabelSchema, YtIssueTagsSchema } from './schemas/yt-types.js'
import type { YtTag } from './schemas/yt-types.js'
```

```typescript
// listYouTrackLabels:
const raw = await youtrackFetch(config, 'GET', '/api/tags', { ... })
const tags = YtLabelSchema.array().parse(raw)

// createYouTrackLabel:
const raw = await youtrackFetch(config, 'POST', '/api/tags', { ... })
const tag = YtLabelSchema.parse(raw)

// updateYouTrackLabel:
const raw = await youtrackFetch(config, 'POST', `/api/tags/${labelId}`, { ... })
const tag = YtLabelSchema.parse(raw)

// addYouTrackTaskLabel (reads issue tags):
const raw = await youtrackFetch(config, 'GET', `/api/issues/${taskId}`, { query: { fields: 'id,tags(id)' } })
const issue = YtIssueTagsSchema.parse(raw)
// Then use issue.tags instead of issue.tags typed as { tags?: YtTag[] }

// removeYouTrackTaskLabel (reads issue tags):
const raw = await youtrackFetch(config, 'GET', `/api/issues/${taskId}`, { query: { fields: 'id,tags(id)' } })
const issue = YtIssueTagsSchema.parse(raw)
```

Note: the type parameter `{ tags?: YtTag[] }` in the original `addYouTrackTaskLabel` and `removeYouTrackTaskLabel` must be removed since we're now parsing.

**Step 5: Update `relations.ts`**

```typescript
// Remove:
import type { YtIssue } from './types.js'

// Add:
import { YtIssueLinksSchema } from './schemas/yt-types.js'
```

```typescript
// removeYouTrackRelation:
const raw = await youtrackFetch(config, 'GET', `/api/issues/${taskId}`, {
  query: { fields: 'id,links(id,direction,linkType(name),issues(id,idReadable))' },
})
const issue = YtIssueLinksSchema.parse(raw)
// Then use issue.links instead of issue.links typed via YtIssue
```

**Step 6: Run full test suite**

```bash
bun run test tests/providers/youtrack/
```

Expected: all pass.

**Step 7: Commit**

```bash
git add src/providers/youtrack/operations/tasks.ts src/providers/youtrack/operations/comments.ts src/providers/youtrack/operations/projects.ts src/providers/youtrack/labels.ts src/providers/youtrack/relations.ts
git commit -m "feat(youtrack): wire Zod parse() into all operations for runtime API response validation"
```

---

### Task 5: Delete `types.ts` and remove knip ignore

**Files:**

- Delete: `src/providers/youtrack/types.ts`
- Modify: `knip.jsonc`

**Step 1: Verify no remaining imports from `types.ts`**

```bash
grep -r "from.*youtrack/types\|from.*youtrack\/types" src/ tests/
```

Expected: no output. If any files still import from `types.ts`, fix them now.

**Step 2: Delete `types.ts`**

```bash
rm src/providers/youtrack/types.ts
```

**Step 3: Remove the `ignoreFiles` entry from `knip.jsonc`**

In `knip.jsonc`, remove this block:

```jsonc
// TODO: YouTrack schemas are currently only used in tests.
// Once imported in production code (like kaneo schemas), remove this ignore.
"ignoreFiles": ["src/providers/youtrack/schemas/**/*.ts"],
```

**Step 4: Run knip**

```bash
bun run knip
```

Expected: no errors. If knip reports that other schemas (like `agile.ts`, `issue-link.ts` full version) are unused, add them to `ignoreIssues` pointing to the test files that use them — but do NOT add `ignoreFiles` for the whole directory again.

**Step 5: Run full test suite**

```bash
bun run test
```

Expected: all pass.

**Step 6: Commit**

```bash
git add knip.jsonc
git commit -m "chore(youtrack): delete types.ts and remove knip ignoreFiles for schemas"
```

---

### Task 6: Verify and final checks

**Step 1: Run lint**

```bash
bun run lint
```

Expected: no errors.

**Step 2: Run knip**

```bash
bun run knip
```

Expected: no errors.

**Step 3: Run all tests**

```bash
bun run test
```

Expected: all pass.

**Step 4: Final commit if needed**

If any lint/knip fixes were needed, commit them:

```bash
git add -p
git commit -m "fix(youtrack): address lint and knip issues after schema migration"
```
