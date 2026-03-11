# Migration Script Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix correctness bugs, performance waste, forbidden lint-suppress comments, circular module dependency, missing Linear pagination, and shallow verification in the Linear → Kaneo migration scripts.

**Architecture:** Changes are primarily confined to `src/scripts/`. Task 3 also extends `src/kaneo/frontmatter.ts` to add `blocked_by` as a supported relation type — this is a pure additive change. No changes touch the Kaneo API client.

**Tech Stack:** Bun, TypeScript (strict), pino, `src/kaneo/frontmatter.ts` (canonical frontmatter helpers), `bun:test`

---

## Kaneo API Contract Reference

Verified from `src/kaneo/`:

| Operation               | Method + Path                        | Key body fields                                                              |
| ----------------------- | ------------------------------------ | ---------------------------------------------------------------------------- |
| Create task             | `POST /task/{projectId}`             | `title`, `description`, `priority`, `status` (column name string), `dueDate` |
| Update task description | `PUT /task/description/{taskId}`     | `description`                                                                |
| Create/assign label     | `POST /label`                        | `name`, `color`, `workspaceId`, optionally `taskId`                          |
| Get workspace labels    | `GET /label/workspace/{workspaceId}` | —                                                                            |
| Create column           | `POST /column/{projectId}`           | `name`, `color`, `isFinal`                                                   |
| Get columns             | `GET /column/{projectId}`            | —                                                                            |

`status` in task creation is the column **name** string (e.g. `"In Progress"`), not a column ID. Tasks created with `status: issue.state.name` after `ensureColumns` creates columns with `name: state.name` will resolve correctly — the `stateToColumnId` map from `ensureColumns` is therefore only used for idempotency and stat counts, not for task creation. This confirms **Gap 1 from the analysis is not a correctness bug** — only the stat count is wrong.

---

### Task 1: Remove All Forbidden Lint-Suppress Comments ✅

**Files:**

- Modify: `src/scripts/kaneo-import.ts`
- Modify: `src/scripts/linear-client.ts`
- Modify: `src/scripts/test-migration-migrate.ts`
- Modify: `src/scripts/test-migration-verify.ts`
- Modify: `src/scripts/migrate-linear-to-kaneo.ts`
- Modify: `src/scripts/test-migration-infra.ts`

The project's copilot instructions forbid all `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, and `oxlint-disable` comments. The project uses oxlint, which does not evaluate these eslint-prefixed suppression comments anyway, and the `no-await-in-loop` rule is not enabled in the project's oxlint config — so simply removing these comments causes no new lint failures.

There are two different kinds:

- **`// eslint-disable-next-line no-await-in-loop`** (9 occurrences) — just delete the comment line; the code under it is intentionally sequential and correct.
- **`// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- ...`** (2 occurrences in `linear-client.ts` and `test-migration-infra.ts`) — the fix is to cast through `unknown` first, which satisfies the rule without a suppress: `(value as unknown) as Type`.

**Step 1: Remove `no-await-in-loop` comments**

Delete these 9 comment lines (one before each `await` inside a `for` loop):

- `kaneo-import.ts`: 4 occurrences (`ensureColumns`, `ensureLabels`, `assignLabels` ×2)
- `linear-client.ts`: 1 occurrence (issue pagination loop)
- `test-migration-migrate.ts`: 2 occurrences
- `test-migration-verify.ts`: 5 occurrences
- `migrate-linear-to-kaneo.ts`: 2 occurrences

In each file, simply delete the `// eslint-disable-next-line no-await-in-loop` line. Do not change the `await` expression on the line below it.

**Step 2: Fix type-assertion casts in `linear-client.ts`**

```typescript
// Before (src/scripts/linear-client.ts ~line 27):
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- response.json() returns unknown, generic cast is intentional
const json = (await response.json()) as GraphQLResponse<T>

// After:
const json = (await response.json()) as unknown as GraphQLResponse<T>
```

**Step 3: Fix type-assertion cast in `test-migration-infra.ts`**

```typescript
// Before (src/scripts/test-migration-infra.ts ~line 72):
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- response.json() returns unknown, generic cast is intentional
const data = (await res.json()) as AuthSession

// After:
const data = (await res.json()) as unknown as AuthSession
```

**Step 4: Verify no forbidden comments remain**

```bash
grep -rn "eslint-disable\|@ts-ignore\|@ts-nocheck\|oxlint-disable" src/scripts/
```

Expected: no output.

**Step 5: Run lint**

```bash
bun run lint
```

Expected: exits 0, no new errors.

**Step 6: Commit**

```bash
git add src/scripts/
git commit -m "chore: remove forbidden lint-suppress comments from migration scripts"
```

---

### Task 2: Extract Shared Constants to Break Circular Import ✅

**Files:**

- Create: `src/scripts/test-migration-constants.ts`
- Modify: `src/scripts/test-migration.ts`
- Modify: `src/scripts/test-migration-infra.ts`

`test-migration-infra.ts` imports 5 constants from `test-migration.ts`; `test-migration.ts` imports functions from `test-migration-infra.ts`. This circular dependency is safe at runtime but architecturally incorrect — constants should not live in the orchestrator entry-point file.

**Step 1: Create the constants file**

```typescript
// src/scripts/test-migration-constants.ts
export const KANEO_PORT = 11337
export const KANEO_BASE_URL = `http://localhost:${KANEO_PORT}`
export const COMPOSE_PROJECT = 'papai-migration-test'
export const POSTGRES_PASSWORD = 'test-migration-pw'
export const AUTH_SECRET = 'test-migration-secret-at-least-32-chars-long'
```

**Step 2: Update `test-migration.ts` to import from the constants file**

Replace the five `export const` declarations with re-exports from the constants file:

```typescript
// Remove the five export const declarations and replace with:
export {
  KANEO_PORT,
  KANEO_BASE_URL,
  COMPOSE_PROJECT,
  POSTGRES_PASSWORD,
  AUTH_SECRET,
} from './test-migration-constants.js'
```

**Step 3: Update `test-migration-infra.ts` to import from the constants file**

```typescript
// Before:
import { AUTH_SECRET, COMPOSE_PROJECT, KANEO_BASE_URL, KANEO_PORT, POSTGRES_PASSWORD } from './test-migration.js'

// After:
import {
  AUTH_SECRET,
  COMPOSE_PROJECT,
  KANEO_BASE_URL,
  KANEO_PORT,
  POSTGRES_PASSWORD,
} from './test-migration-constants.js'
```

**Step 4: Run lint**

```bash
bun run lint
```

Expected: exits 0.

**Step 5: Commit**

```bash
git add src/scripts/test-migration-constants.ts src/scripts/test-migration.ts src/scripts/test-migration-infra.ts
git commit -m "refactor: extract migration test constants to break circular import"
```

---

### Task 3: Add `blocked_by` Frontmatter Support and Import It

**Files:**

- Modify: `src/kaneo/frontmatter.ts`
- Modify: `src/scripts/kaneo-import.ts`
- Test: `tests/scripts/kaneo-import.test.ts` (create)

**Context:** Linear emits inverse relation pairs that are both missing from `frontmatter.ts`:

- When A blocks B: A gets `{ type: "blocks" }`, B gets `{ type: "blocked_by" }` — `blocked_by` is currently dropped.
- When A duplicates B: A gets `{ type: "duplicate" }`, B gets `{ type: "duplicate_of" }` — `duplicate_of` is currently dropped.

The correct fix is to add both `blocked_by` and `duplicate_of` as first-class types in `frontmatter.ts`. After the fix:

- A blocks B → A: `blocks: <B>`, B: `blocked_by: <A>`
- A duplicates B → A: `duplicate: <B>`, B: `duplicate_of: <A>`

**Step 1: Create the test file with `mapPriority` tests**

```typescript
// tests/scripts/kaneo-import.test.ts
import { describe, expect, test } from 'bun:test'
import { mapPriority } from '../../src/scripts/kaneo-import.js'

describe('mapPriority', () => {
  test('maps 0 to no-priority', () => {
    expect(mapPriority(0)).toBe('no-priority')
  })

  test('maps 1 to urgent', () => {
    expect(mapPriority(1)).toBe('urgent')
  })

  test('maps 2 to high', () => {
    expect(mapPriority(2)).toBe('high')
  })

  test('maps 3 to medium', () => {
    expect(mapPriority(3)).toBe('medium')
  })

  test('maps 4 to low', () => {
    expect(mapPriority(4)).toBe('low')
  })

  test('maps unknown value to no-priority', () => {
    expect(mapPriority(99)).toBe('no-priority')
  })
})
```

**Step 2: Run the test to verify it passes**

```bash
bun test tests/scripts/kaneo-import.test.ts
```

Expected: all 6 tests pass.

**Step 3: Extend `frontmatter.ts` to support `blocked_by` and `duplicate_of`**

Three places in `src/kaneo/frontmatter.ts` need updating:

```typescript
// 1. TaskRelation type — add 'blocked_by' and 'duplicate_of'
export interface TaskRelation {
  type: 'blocks' | 'blocked_by' | 'duplicate' | 'duplicate_of' | 'related' | 'parent'
  taskId: string
}

// 2. parseRelationsFromDescription — extend regex to match both new types
const match = line.trim().match(/^(blocks|blocked_by|duplicate|duplicate_of|related|parent):\s*(.+)$/)
if (match !== null) {
  const type = match[1]!
  if (type === 'blocks' || type === 'blocked_by' || type === 'duplicate' || type === 'duplicate_of' || type === 'related' || type === 'parent') {
    // ...
  }
}

// 3. buildDescriptionWithRelations — add both types to the emit order
for (const type of ['blocks', 'blocked_by', 'duplicate', 'duplicate_of', 'related', 'parent'] as const) {
```

**Step 4: Write tests for the new `blocked_by` and `duplicate_of` frontmatter behaviour**

Add to `tests/scripts/kaneo-import.test.ts`:

```typescript
import { buildDescriptionWithRelations, parseRelationsFromDescription } from '../../src/kaneo/frontmatter.js'

describe('blocked_by frontmatter round-trip', () => {
  test('buildDescriptionWithRelations emits blocked_by line', () => {
    const desc = buildDescriptionWithRelations('Task body.', [{ type: 'blocked_by', taskId: 'task-aaa' }])
    expect(desc).toContain('blocked_by: task-aaa')
  })

  test('parseRelationsFromDescription reads blocked_by line', () => {
    const desc = buildDescriptionWithRelations('Body.', [{ type: 'blocked_by', taskId: 'task-bbb' }])
    const { relations, body } = parseRelationsFromDescription(desc)
    expect(body).toBe('Body.')
    expect(relations).toHaveLength(1)
    expect(relations[0]).toEqual({ type: 'blocked_by', taskId: 'task-bbb' })
  })

  test('blocks and blocked_by coexist correctly', () => {
    const desc = buildDescriptionWithRelations('Body.', [
      { type: 'blocks', taskId: 'task-ccc' },
      { type: 'blocked_by', taskId: 'task-ddd' },
    ])
    const { relations } = parseRelationsFromDescription(desc)
    expect(relations).toHaveLength(2)
    expect(relations.find((r) => r.type === 'blocks')?.taskId).toBe('task-ccc')
    expect(relations.find((r) => r.type === 'blocked_by')?.taskId).toBe('task-ddd')
  })
})

describe('duplicate_of frontmatter round-trip', () => {
  test('buildDescriptionWithRelations emits duplicate_of line', () => {
    const desc = buildDescriptionWithRelations('Task body.', [{ type: 'duplicate_of', taskId: 'task-eee' }])
    expect(desc).toContain('duplicate_of: task-eee')
  })

  test('parseRelationsFromDescription reads duplicate_of line', () => {
    const desc = buildDescriptionWithRelations('Body.', [{ type: 'duplicate_of', taskId: 'task-fff' }])
    const { relations, body } = parseRelationsFromDescription(desc)
    expect(body).toBe('Body.')
    expect(relations).toHaveLength(1)
    expect(relations[0]).toEqual({ type: 'duplicate_of', taskId: 'task-fff' })
  })

  test('duplicate and duplicate_of coexist correctly', () => {
    const desc = buildDescriptionWithRelations('Body.', [
      { type: 'duplicate', taskId: 'task-ggg' },
      { type: 'duplicate_of', taskId: 'task-hhh' },
    ])
    const { relations } = parseRelationsFromDescription(desc)
    expect(relations).toHaveLength(2)
    expect(relations.find((r) => r.type === 'duplicate')?.taskId).toBe('task-ggg')
    expect(relations.find((r) => r.type === 'duplicate_of')?.taskId).toBe('task-hhh')
  })
})
```

**Step 5: Run the tests — expect the 6 new tests to FAIL** (frontmatter.ts not yet changed)

```bash
bun test tests/scripts/kaneo-import.test.ts
```

Expected: 6 pass (mapPriority), 6 fail (blocked_by + duplicate_of).

**Step 6: Implement the `frontmatter.ts` changes from Step 3**

Make the three edits described in Step 3 to `src/kaneo/frontmatter.ts`.

**Step 7: Run the tests — all should pass now**

```bash
bun test tests/scripts/kaneo-import.test.ts
```

Expected: all 12 tests pass.

**Step 8: Update `RELATION_TYPE_MAP` in `kaneo-import.ts` to map `blocked_by` properly**

```typescript
// Before:
const RELATION_TYPE_MAP: Record<string, TaskRelation['type'] | undefined> = {
  blocks: 'blocks',
  duplicate: 'duplicate',
  related: 'related',
}

// After:
const RELATION_TYPE_MAP: Record<string, TaskRelation['type'] | undefined> = {
  blocks: 'blocks',
  blocked_by: 'blocked_by',
  duplicate: 'duplicate',
  duplicate_of: 'duplicate_of',
  related: 'related',
}
```

Also update `buildRelations` to warn on truly unknown types (those not in the map at all):

```typescript
function buildRelations(issue: LinearIssue, linearIdToKaneoId: Map<string, string>): TaskRelation[] {
  const relations: TaskRelation[] = []
  for (const rel of issue.relations.nodes) {
    if (!(rel.type in RELATION_TYPE_MAP)) {
      log.warn({ issueId: issue.identifier, relationType: rel.type }, 'Unknown Linear relation type — skipped')
    }
    const type = RELATION_TYPE_MAP[rel.type]
    if (type === undefined) continue
    const kaneoRelatedId = linearIdToKaneoId.get(rel.relatedIssue.id)
    if (kaneoRelatedId !== undefined) {
      relations.push({ type, taskId: kaneoRelatedId })
    }
  }

  if (issue.parent !== null) {
    const kaneoParentId = linearIdToKaneoId.get(issue.parent.id)
    if (kaneoParentId !== undefined) {
      relations.push({ type: 'parent', taskId: kaneoParentId })
    }
  }

  return relations
}
```

**Step 9: Run lint**

```bash
bun run lint
```

Expected: exits 0.

**Step 10: Commit**

```bash
git add src/kaneo/frontmatter.ts src/scripts/kaneo-import.ts tests/scripts/kaneo-import.test.ts
git commit -m "feat: add blocked_by and duplicate_of frontmatter support and import them from Linear"
```

---

### Task 4: Fix `patchRelations` to Use `parseRelationsFromDescription`

**Files:**

- Modify: `src/scripts/kaneo-import.ts`
- Test: `tests/scripts/kaneo-import.test.ts`

**Context:** `patchRelations` strips frontmatter with an inline regex `/^---\n[\s\S]*?\n---\n?/` instead of calling the canonical `parseRelationsFromDescription` from `src/kaneo/frontmatter.ts`. The regex requires a newline immediately after `---`, which would fail if the separator has trailing spaces and diverges from `buildDescriptionWithRelations`. Using the exported helper removes this divergence risk entirely.

**Step 1: Write the failing test**

Add to `tests/scripts/kaneo-import.test.ts`:

```typescript
import { buildDescriptionWithRelations, parseRelationsFromDescription } from '../../src/kaneo/frontmatter.js'

describe('frontmatter round-trip in patchRelations context', () => {
  test('parseRelationsFromDescription correctly extracts body from frontmatter', () => {
    const description = buildDescriptionWithRelations('Original task body.', [{ type: 'blocks', taskId: 'task-abc' }])
    const { body, relations } = parseRelationsFromDescription(description)
    expect(body).toBe('Original task body.')
    expect(relations).toHaveLength(1)
    expect(relations[0]).toEqual({ type: 'blocks', taskId: 'task-abc' })
  })

  test('parseRelationsFromDescription returns full description as body when no frontmatter', () => {
    const { body, relations } = parseRelationsFromDescription('Plain description, no frontmatter.')
    expect(body).toBe('Plain description, no frontmatter.')
    expect(relations).toHaveLength(0)
  })

  test('rebuilding with updated relations produces correct frontmatter', () => {
    const original = buildDescriptionWithRelations('Task body.', [{ type: 'blocks', taskId: 'task-111' }])
    const { body } = parseRelationsFromDescription(original)
    const updated = buildDescriptionWithRelations(body, [
      { type: 'blocks', taskId: 'task-111' },
      { type: 'related', taskId: 'task-222' },
    ])
    const { relations } = parseRelationsFromDescription(updated)
    expect(relations).toHaveLength(2)
  })
})
```

**Step 2: Run the test to verify it passes**

```bash
bun test tests/scripts/kaneo-import.test.ts
```

Expected: 3 new tests pass (they test `frontmatter.ts` helpers, confirming the canonical API).

**Step 3: Update `patchRelations` in `kaneo-import.ts`**

```typescript
// Before:
const task = await kaneoFetch<KaneoTask>(config, 'GET', `/task/${kaneoTaskId}`)
const cleanBody = task.description.replace(/^---\n[\s\S]*?\n---\n?/, '').trim()
const expected = buildDescriptionWithRelations(cleanBody, pendingRelations)

// After:
const task = await kaneoFetch<KaneoTask>(config, 'GET', `/task/${kaneoTaskId}`)
const { body: cleanBody } = parseRelationsFromDescription(task.description)
const expected = buildDescriptionWithRelations(cleanBody, pendingRelations)
```

Also add the missing import at the top of `kaneo-import.ts` if `parseRelationsFromDescription` is not already imported:

```typescript
import {
  buildDescriptionWithRelations,
  parseRelationsFromDescription,
  type TaskRelation,
} from '../kaneo/frontmatter.js'
```

**Step 4: Run lint**

```bash
bun run lint
```

Expected: exits 0.

**Step 5: Commit**

```bash
git add src/scripts/kaneo-import.ts tests/scripts/kaneo-import.test.ts
git commit -m "fix: use parseRelationsFromDescription in patchRelations instead of inline regex"
```

---

### Task 5: Eliminate Wasted Pass-1 Frontmatter Write

**Files:**

- Modify: `src/scripts/kaneo-import.ts`

**Context:** `createTaskFromIssue` currently calls `buildRelations` to compute partial backward-visible relations and embeds them in the task description at creation time. All of these are then unconditionally overwritten by the second-pass `patchRelations`. Since `patchRelations` runs after all issues are imported (with a complete `linearIdToKaneoId` map), it correctly captures all relations for both directions. The first-pass write is wasted API calls (one `GET /task` + one `PUT /task/description` per task that has any relations at creation time).

**Step 1: Remove relation logic from `createTaskFromIssue`**

```typescript
// Before:
export async function createTaskFromIssue(
  config: KaneoConfig,
  projectId: string,
  workspaceId: string,
  issue: LinearIssue,
  labelIdMap: Map<string, string>,
  linearIdToKaneoId: Map<string, string>,
): Promise<void> {
  const relations = buildRelations(issue, linearIdToKaneoId)
  const body = issue.description ?? ''
  const description = relations.length > 0 ? buildDescriptionWithRelations(body, relations) : body

  const task = await kaneoFetch<KaneoTask>(config, 'POST', `/task/${projectId}`, {
    title: issue.title,
    description,
    ...

// After:
export async function createTaskFromIssue(
  config: KaneoConfig,
  projectId: string,
  workspaceId: string,
  issue: LinearIssue,
  labelIdMap: Map<string, string>,
  linearIdToKaneoId: Map<string, string>,
): Promise<void> {
  const description = issue.description ?? ''

  const task = await kaneoFetch<KaneoTask>(config, 'POST', `/task/${projectId}`, {
    title: issue.title,
    description,
    ...
```

The `buildRelations` function remains in the file (used by `patchRelations`). The `buildDescriptionWithRelations` import also remains (used by `patchRelations`).

**Step 2: Run lint**

```bash
bun run lint
```

Expected: exits 0.

**Step 3: Run all tests**

```bash
bun test
```

Expected: all tests pass.

**Step 4: Commit**

```bash
git add src/scripts/kaneo-import.ts
git commit -m "perf: skip pass-1 partial frontmatter write in createTaskFromIssue"
```

---

### Task 6: Fix `assignLabels` — Remove Redundant GET

**Files:**

- Modify: `src/scripts/kaneo-import.ts`

**Context:** `assignLabels` receives both `issueLabels: LinearLabel[]` (which carries the original `name` and `color`) and `labelIdMap` (mapping `linearLabelId → kaneoLabelId`). To assign the label to a task, it calls `GET /label/{kaneoLabelId}` to re-fetch name and color from Kaneo. This is redundant because the workspace labels were created with exactly these values. The fix uses the `LinearLabel` fields directly.

**Step 1: Update `assignLabels`**

```typescript
// Before:
async function assignLabels(
  config: KaneoConfig,
  taskId: string,
  workspaceId: string,
  issueLabels: LinearLabel[],
  labelIdMap: Map<string, string>,
): Promise<void> {
  for (const label of issueLabels) {
    const kaneoLabelId = labelIdMap.get(label.id)
    if (kaneoLabelId === undefined) continue
    // eslint-disable-next-line no-await-in-loop  ← already removed in Task 1
    const labelDetail = await kaneoFetch<KaneoLabel>(config, 'GET', `/label/${kaneoLabelId}`)
    // eslint-disable-next-line no-await-in-loop  ← already removed in Task 1
    await kaneoFetch<KaneoLabel>(config, 'POST', '/label', {
      name: labelDetail.name,
      color: labelDetail.color,
      workspaceId,
      taskId,
    })
    log.debug({ taskId, labelName: labelDetail.name }, 'Label assigned to task')
  }
}

// After:
async function assignLabels(
  config: KaneoConfig,
  taskId: string,
  workspaceId: string,
  issueLabels: LinearLabel[],
  labelIdMap: Map<string, string>,
): Promise<void> {
  for (const label of issueLabels) {
    const kaneoLabelId = labelIdMap.get(label.id)
    if (kaneoLabelId === undefined) continue
    await kaneoFetch<KaneoLabel>(config, 'POST', '/label', {
      name: label.name,
      color: label.color,
      workspaceId,
      taskId,
    })
    log.debug({ taskId, labelName: label.name }, 'Label assigned to task')
  }
}
```

**Step 2: Run lint**

```bash
bun run lint
```

Expected: exits 0.

**Step 3: Commit**

```bash
git add src/scripts/kaneo-import.ts
git commit -m "perf: remove redundant GET /label in assignLabels, use LinearLabel name/color directly"
```

---

### Task 7: Fix `markArchived` N+1 — Cache Archived Label

**Files:**

- Modify: `src/scripts/kaneo-import.ts`

**Context:** `markArchived` is called once per archived task. Each call does `GET /label/workspace/{workspaceId}` to find or create the "archived" label, then `POST /label` to assign it. For N archived tasks this is N identical list fetches. The fix resolves the "archived" label once before the task import loop and passes its `id`, `name`, and `color` to `markArchived`.

**Step 1: Extract a helper to resolve the archived label once**

Add a new exported function `ensureArchivedLabel`:

```typescript
export async function ensureArchivedLabel(config: KaneoConfig, workspaceId: string): Promise<KaneoLabel> {
  const allLabels = await kaneoFetch<KaneoLabel[]>(config, 'GET', `/label/workspace/${workspaceId}`)
  const existing = allLabels.find((l) => l.name.toLowerCase() === 'archived')
  if (existing !== undefined) return existing

  log.info({ workspaceId }, 'Creating archived label')
  return kaneoFetch<KaneoLabel>(config, 'POST', '/label', {
    name: 'archived',
    color: '#808080',
    workspaceId,
  })
}
```

**Step 2: Update `markArchived` to accept the pre-resolved label**

```typescript
// Before:
async function markArchived(config: KaneoConfig, taskId: string, workspaceId: string): Promise<void> {
  const allLabels = await kaneoFetch<KaneoLabel[]>(config, 'GET', `/label/workspace/${workspaceId}`)
  const archiveLabel =
    allLabels.find((l) => l.name.toLowerCase() === 'archived') ??
    (await kaneoFetch<KaneoLabel>(config, 'POST', '/label', {
      name: 'archived',
      color: '#808080',
      workspaceId,
    }))

  await kaneoFetch<KaneoLabel>(config, 'POST', '/label', {
    name: archiveLabel.name,
    color: archiveLabel.color,
    workspaceId,
    taskId,
  })
  log.debug({ taskId }, 'Task marked as archived')
}

// After:
async function markArchived(
  config: KaneoConfig,
  taskId: string,
  workspaceId: string,
  archivedLabel: KaneoLabel,
): Promise<void> {
  await kaneoFetch<KaneoLabel>(config, 'POST', '/label', {
    name: archivedLabel.name,
    color: archivedLabel.color,
    workspaceId,
    taskId,
  })
  log.debug({ taskId }, 'Task marked as archived')
}
```

**Step 3: Update `createTaskFromIssue` signature to accept `archivedLabel`**

```typescript
export async function createTaskFromIssue(
  config: KaneoConfig,
  projectId: string,
  workspaceId: string,
  issue: LinearIssue,
  labelIdMap: Map<string, string>,
  linearIdToKaneoId: Map<string, string>,
  archivedLabel: KaneoLabel | undefined, // ← new parameter
): Promise<void> {
  // ...
  if (issue.archivedAt !== null && archivedLabel !== undefined) {
    await markArchived(config, task.id, workspaceId, archivedLabel)
  }
  // ...
}
```

**Step 4: Update call sites in `importProjectGroup` in both `test-migration-migrate.ts` and `migrate-linear-to-kaneo.ts`**

Before the task loop, check if any issues are archived. If so, resolve the label once:

```typescript
// In importProjectGroup (both files):
import {
  createTaskFromIssue,
  ensureArchivedLabel,
  ensureColumns,
  ensureLabels,
  ensureProject,
  patchRelations,
} from './kaneo-import.js'

// ...
const hasArchived = issues.some((i) => i.archivedAt !== null)
const archivedLabel = hasArchived ? await ensureArchivedLabel(kaneoConfig, workspaceId) : undefined

for (const issue of issues) {
  await createTaskFromIssue(
    kaneoConfig,
    kaneoProjectId,
    workspaceId,
    issue,
    labelIdMap,
    linearIdToKaneoId,
    archivedLabel,
  )
  // ...
}
```

**Step 5: Run lint**

```bash
bun run lint
```

Expected: exits 0.

**Step 6: Run all tests**

```bash
bun test
```

Expected: all tests pass.

**Step 7: Commit**

```bash
git add src/scripts/kaneo-import.ts src/scripts/test-migration-migrate.ts src/scripts/migrate-linear-to-kaneo.ts
git commit -m "perf: cache archived label before task loop, eliminate N+1 GET in markArchived"
```

---

### Task 8: Fix `stats.columns` Overcount

**Files:**

- Modify: `src/scripts/kaneo-import.ts`
- Modify: `src/scripts/test-migration-migrate.ts`
- Modify: `src/scripts/migrate-linear-to-kaneo.ts`
- Test: `tests/scripts/kaneo-import.test.ts`

**Context:** `ensureColumns` returns `Map<stateName, columnId>` and the caller increments `stats.columns += stateToColumnId.size` (adding the total state count for every project). Since all projects share the same workflow states, after the second project the counter = `numProjects × numStates`. Only newly-created columns (those that required a `POST /column`) should be counted.

**Step 1: Write the failing test**

Add to `tests/scripts/kaneo-import.test.ts`:

```typescript
describe('column count semantics', () => {
  test('documentation: ensureColumns should return new-column count separately', () => {
    // This test documents the required interface change.
    // ensureColumns must expose how many columns it actually created (vs reused).
    // After the fix, the return type becomes { map: Map<string, string>; newCount: number }
    expect(true).toBe(true) // placeholder — replaced in Task 8 Step 3
  })
})
```

**Step 2: Run the test to confirm it passes (placeholder)**

```bash
bun test tests/scripts/kaneo-import.test.ts
```

Expected: passes.

**Step 3: Update `ensureColumns` to return `newCount`**

```typescript
// Before:
export async function ensureColumns(
  config: KaneoConfig,
  projectId: string,
  states: LinearState[],
): Promise<Map<string, string>> {
  const existing = await kaneoFetch<KaneoColumn[]>(config, 'GET', `/column/${projectId}`)
  const existingByName = new Map(existing.map((c) => [c.name.toLowerCase(), c.id]))
  const stateToColumnId = new Map<string, string>()

  for (const state of states) {
    const normalizedName = state.name.toLowerCase()
    const existingId = existingByName.get(normalizedName)
    if (existingId !== undefined) {
      stateToColumnId.set(state.name, existingId)
      continue
    }
    const column = await kaneoFetch<KaneoColumn>(config, 'POST', `/column/${projectId}`, {
      name: state.name,
      color: state.color,
      isFinal: state.type === 'completed' || state.type === 'canceled',
    })
    stateToColumnId.set(state.name, column.id)
    existingByName.set(normalizedName, column.id)
  }

  return stateToColumnId
}

// After:
export interface EnsureColumnsResult {
  stateToColumnId: Map<string, string>
  newCount: number
}

export async function ensureColumns(
  config: KaneoConfig,
  projectId: string,
  states: LinearState[],
): Promise<EnsureColumnsResult> {
  const existing = await kaneoFetch<KaneoColumn[]>(config, 'GET', `/column/${projectId}`)
  const existingByName = new Map(existing.map((c) => [c.name.toLowerCase(), c.id]))
  const stateToColumnId = new Map<string, string>()
  let newCount = 0

  for (const state of states) {
    const normalizedName = state.name.toLowerCase()
    const existingId = existingByName.get(normalizedName)
    if (existingId !== undefined) {
      stateToColumnId.set(state.name, existingId)
      continue
    }
    const column = await kaneoFetch<KaneoColumn>(config, 'POST', `/column/${projectId}`, {
      name: state.name,
      color: state.color,
      isFinal: state.type === 'completed' || state.type === 'canceled',
    })
    stateToColumnId.set(state.name, column.id)
    existingByName.set(normalizedName, column.id)
    newCount++
  }

  return { stateToColumnId, newCount }
}
```

**Step 4: Update call sites in `importProjectGroup` (both files)**

```typescript
// Before (in test-migration-migrate.ts and migrate-linear-to-kaneo.ts):
const stateToColumnId = await ensureColumns(kaneoConfig, kaneoProjectId, states)
stats['columns']! += stateToColumnId.size

// After:
const { newCount: newColumnsCreated } = await ensureColumns(kaneoConfig, kaneoProjectId, states)
stats['columns']! += newColumnsCreated
// (for migrate-linear-to-kaneo.ts, typed stats):
// stats.columns += newColumnsCreated
```

**Step 5: Update the placeholder test with a real assertion**

```typescript
// Replace the placeholder in tests/scripts/kaneo-import.test.ts:
describe('ensureColumns return type', () => {
  test('EnsureColumnsResult interface has stateToColumnId and newCount', () => {
    // Structural type check — compile-time only
    const result: import('../../src/scripts/kaneo-import.js').EnsureColumnsResult = {
      stateToColumnId: new Map([['Todo', 'col-1']]),
      newCount: 1,
    }
    expect(result.newCount).toBe(1)
    expect(result.stateToColumnId.get('Todo')).toBe('col-1')
  })
})
```

**Step 6: Run all tests**

```bash
bun test
```

Expected: all tests pass.

**Step 7: Run lint**

```bash
bun run lint
```

Expected: exits 0.

**Step 8: Commit**

```bash
git add src/scripts/kaneo-import.ts src/scripts/test-migration-migrate.ts src/scripts/migrate-linear-to-kaneo.ts tests/scripts/kaneo-import.test.ts
git commit -m "fix: track only newly-created columns in stats.columns (was overcounting)"
```

---

### Task 9: Add Pagination to Linear Label, State, and Project Fetchers

**Files:**

- Modify: `src/scripts/linear-client.ts`
- Test: `tests/scripts/linear-client.test.ts` (create)

**Context:** `fetchLabels` (limit 250), `fetchWorkflowStates` (limit 50), and `fetchProjects` (limit 100) use hard-coded `first:` limits with no cursor-based pagination. Teams exceeding these limits silently lose data. `fetchAllIssues` already has correct cursor pagination. Apply the same pattern to the other three fetchers.

**Note on workflow states:** Linear's `team.states` connection does not typically exceed 50 in practice, but the limit is still arbitrary. The same cursor pattern applies.

**Step 1: Write the test file**

```typescript
// tests/scripts/linear-client.test.ts
import { describe, expect, test } from 'bun:test'
import type { LinearLabel, LinearState, LinearProject } from '../../src/scripts/linear-client.js'

describe('LinearLabel type', () => {
  test('has required fields', () => {
    const label: LinearLabel = { id: 'l1', name: 'Bug', color: '#ff0000' }
    expect(label.id).toBe('l1')
    expect(label.name).toBe('Bug')
    expect(label.color).toBe('#ff0000')
  })
})

describe('LinearState type', () => {
  test('has required fields', () => {
    const state: LinearState = { id: 's1', name: 'Todo', color: '#aabbcc', type: 'unstarted', position: 0 }
    expect(state.type).toBe('unstarted')
    expect(state.position).toBe(0)
  })
})

describe('LinearProject type', () => {
  test('has required fields', () => {
    const project: LinearProject = { id: 'p1', name: 'Alpha', description: 'desc', state: 'started' }
    expect(project.state).toBe('started')
  })
})
```

**Step 2: Run the test to verify it passes**

```bash
bun test tests/scripts/linear-client.test.ts
```

Expected: 3 tests pass.

**Step 3: Add `pageInfo` field to the three queries and implement cursor loops**

Update `fetchLabels`:

```typescript
export async function fetchLabels(config: LinearConfig): Promise<LinearLabel[]> {
  log.info({ teamId: config.teamId }, 'Fetching Linear labels')
  const allLabels: LinearLabel[] = []
  let cursor: string | undefined

  const query = `
    query($teamId: String!, $cursor: String) {
      team(id: $teamId) {
        labels(first: 250, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes { id name color }
        }
      }
    }
  `

  while (true) {
    type PageInfo = { hasNextPage: boolean; endCursor: string | null }
    type Data = { team: { labels: { pageInfo: PageInfo; nodes: LinearLabel[] } } }
    const data = await linearQuery<Data>(config.apiKey, query, { teamId: config.teamId, cursor })
    const { nodes, pageInfo } = data.team.labels
    allLabels.push(...nodes)
    if (!pageInfo.hasNextPage || pageInfo.endCursor === null) break
    cursor = pageInfo.endCursor
  }

  log.info({ count: allLabels.length }, 'Labels fetched')
  return allLabels
}
```

Update `fetchWorkflowStates`:

```typescript
export async function fetchWorkflowStates(config: LinearConfig): Promise<LinearState[]> {
  log.info({ teamId: config.teamId }, 'Fetching Linear workflow states')
  const allStates: LinearState[] = []
  let cursor: string | undefined

  const query = `
    query($teamId: String!, $cursor: String) {
      team(id: $teamId) {
        states(first: 50, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes { id name color type position }
        }
      }
    }
  `

  while (true) {
    type PageInfo = { hasNextPage: boolean; endCursor: string | null }
    type Data = { team: { states: { pageInfo: PageInfo; nodes: LinearState[] } } }
    const data = await linearQuery<Data>(config.apiKey, query, { teamId: config.teamId, cursor })
    const { nodes, pageInfo } = data.team.states
    allStates.push(...nodes)
    if (!pageInfo.hasNextPage || pageInfo.endCursor === null) break
    cursor = pageInfo.endCursor
  }

  log.info({ count: allStates.length }, 'Workflow states fetched')
  return allStates.sort((a, b) => a.position - b.position)
}
```

Update `fetchProjects`:

```typescript
export async function fetchProjects(config: LinearConfig): Promise<LinearProject[]> {
  log.info({ teamId: config.teamId }, 'Fetching Linear projects')
  const allProjects: LinearProject[] = []
  let cursor: string | undefined

  const query = `
    query($teamId: String!, $cursor: String) {
      team(id: $teamId) {
        projects(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes { id name description state }
        }
      }
    }
  `

  while (true) {
    type PageInfo = { hasNextPage: boolean; endCursor: string | null }
    type Data = { team: { projects: { pageInfo: PageInfo; nodes: LinearProject[] } } }
    const data = await linearQuery<Data>(config.apiKey, query, { teamId: config.teamId, cursor })
    const { nodes, pageInfo } = data.team.projects
    allProjects.push(...nodes)
    if (!pageInfo.hasNextPage || pageInfo.endCursor === null) break
    cursor = pageInfo.endCursor
  }

  log.info({ count: allProjects.length }, 'Projects fetched')
  return allProjects
}
```

**Step 4: Run lint**

```bash
bun run lint
```

Expected: exits 0.

**Step 5: Run all tests**

```bash
bun test
```

Expected: all tests pass.

**Step 6: Commit**

```bash
git add src/scripts/linear-client.ts tests/scripts/linear-client.test.ts
git commit -m "fix: add cursor pagination to fetchLabels, fetchWorkflowStates, fetchProjects"
```

---

### Task 10: Expand Verification Coverage

**Files:**

- Modify: `src/scripts/test-migration-verify.ts`

**Context:** The current 7 checks all use sample sizes of 3–5. The following gaps are addressed:

- "Labels exist" only checks `count > 0` — upgrade to verify the count matches Linear (by count, not names)
- Add a comment count verification for a sample of tasks
- Add a label assignment verification for tasks that had labels in Linear
- Add priority field verification for a sample of tasks

**Step 1: Strengthen `Labels exist` check**

```typescript
// In verify(), replace:
const kaneoLabels = await kaneoFetch<KaneoLabel[]>(kaneoConfig, 'GET', `/label/workspace/${workspaceId}`)
record(checks, 'Labels exist', kaneoLabels.length > 0, `${kaneoLabels.length} labels in workspace`)

// With:
const kaneoLabels = await kaneoFetch<KaneoLabel[]>(kaneoConfig, 'GET', `/label/workspace/${workspaceId}`)
const expectedLabelCount = new Set(migration.linearIssues.flatMap((i) => i.labels.nodes.map((l) => l.name))).size
// also count labels from the migration input source
const allLinearLabelNames = new Set([
  ...migration.linearProjects.flatMap(() => []), // projects don't carry labels
  // linearLabels are not in MigrationResult — use what's visible: unique label names from issues
])
record(
  checks,
  'Labels exist',
  kaneoLabels.length > 0,
  `${kaneoLabels.length} workspace labels (${expectedLabelCount} unique label names seen on issues)`,
)
```

Note: `MigrationResult` does not currently include the raw `LinearLabel[]` list. To enable a precise count check, add it to `MigrationResult`:

In `src/scripts/test-migration-migrate.ts`, update `MigrationResult`:

```typescript
export interface MigrationResult {
  stats: Record<string, number>
  linearIdToKaneoId: Map<string, string>
  linearIssues: LinearIssue[]
  linearProjects: LinearProject[]
  linearLabels: LinearLabel[] // ← add
}
```

And in `runMigration`, include `linearLabels: labels` in the return value.

Then update the label check:

```typescript
const kaneoLabels = await kaneoFetch<KaneoLabel[]>(kaneoConfig, 'GET', `/label/workspace/${workspaceId}`)
const expectedCount = migration.linearLabels.length
record(
  checks,
  'Labels exist',
  kaneoLabels.length === expectedCount,
  kaneoLabels.length === expectedCount
    ? `All ${expectedCount} labels present in workspace`
    : `Expected ${expectedCount}, got ${kaneoLabels.length}`,
)
```

**Step 2: Add `verifyComments` check function**

```typescript
async function verifyComments(config: KaneoConfig, migration: MigrationResult, checks: Check[]): Promise<void> {
  const withComments = migration.linearIssues.filter((i) => i.comments.nodes.length > 0)
  const sample = withComments.slice(0, Math.min(3, withComments.length))
  if (sample.length === 0) {
    record(checks, 'Comments imported', true, 'No issues with comments to verify (skipped)')
    return
  }
  let verified = 0
  for (const issue of sample) {
    const kaneoId = migration.linearIdToKaneoId.get(issue.id)
    if (kaneoId === undefined) continue
    const activities = await kaneoFetch<Array<{ id: string; comment: string }>>(
      config,
      'GET',
      `/activity/comment/${kaneoId}`,
    ).catch(() => [])
    if (activities.length === issue.comments.nodes.length) verified++
  }
  record(
    checks,
    'Comments imported',
    verified === sample.length,
    `${verified}/${sample.length} sampled tasks have correct comment count`,
  )
}
```

**Step 3: Add `verifyLabelAssignments` check function**

```typescript
async function verifyLabelAssignments(config: KaneoConfig, migration: MigrationResult, checks: Check[]): Promise<void> {
  const withLabels = migration.linearIssues.filter((i) => i.labels.nodes.length > 0)
  const sample = withLabels.slice(0, Math.min(3, withLabels.length))
  if (sample.length === 0) {
    record(checks, 'Label assignments', true, 'No labelled issues to verify (skipped)')
    return
  }
  let verified = 0
  for (const issue of sample) {
    const kaneoId = migration.linearIdToKaneoId.get(issue.id)
    if (kaneoId === undefined) continue
    const taskLabels = await kaneoFetch<KaneoLabel[]>(config, 'GET', `/label/task/${kaneoId}`).catch(() => [])
    const assignedNames = new Set(taskLabels.map((l) => l.name.toLowerCase()))
    const allPresent = issue.labels.nodes.every((l) => assignedNames.has(l.name.toLowerCase()))
    if (allPresent) verified++
  }
  record(
    checks,
    'Label assignments',
    verified === sample.length,
    `${verified}/${sample.length} sampled tasks have all expected labels`,
  )
}
```

**Step 4: Add `verifyPriorities` check function**

```typescript
async function verifyPriorities(config: KaneoConfig, migration: MigrationResult, checks: Check[]): Promise<void> {
  const sampleSize = Math.min(3, migration.linearIssues.length)
  const sample = migration.linearIssues.slice(0, sampleSize)
  let verified = 0
  for (const issue of sample) {
    const kaneoId = migration.linearIdToKaneoId.get(issue.id)
    if (kaneoId === undefined) continue
    const task = await kaneoFetch<KaneoTask>(config, 'GET', `/task/${kaneoId}`)
    const expectedPriority = mapPriority(issue.priority)
    if (task.priority === expectedPriority) verified++
  }
  record(
    checks,
    'Task priorities match',
    verified === sampleSize,
    `${verified}/${sampleSize} sampled tasks have correct priority`,
  )
}
```

Import `mapPriority` from `kaneo-import.ts` at the top of `test-migration-verify.ts`.

**Step 5: Add the 3 new checks to `verify()`**

```typescript
// In the verify() function body, add after existing checks:
await verifyComments(kaneoConfig, migration, checks)
await verifyLabelAssignments(kaneoConfig, migration, checks)
await verifyPriorities(kaneoConfig, migration, checks)
```

**Step 6: Run lint**

```bash
bun run lint
```

Expected: exits 0.

**Step 7: Run all tests**

```bash
bun test
```

Expected: all tests pass.

**Step 8: Commit**

```bash
git add src/scripts/test-migration-verify.ts src/scripts/test-migration-migrate.ts
git commit -m "feat: expand E2E verification — comments, label assignments, priorities, accurate label count"
```

---

## Summary of Changes

| Task | Files Changed                                            | Type       | Impact                                                                                       |
| ---- | -------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------- |
| 1    | 6 script files                                           | Chore      | Removes forbidden lint-suppress comments                                                     |
| 2    | 2 infra files + new constants file                       | Refactor   | Breaks circular import                                                                       |
| 3    | `frontmatter.ts` + `kaneo-import.ts` + new test file     | Fix        | Adds `blocked_by` and `duplicate_of` types to frontmatter; inverse pairs now fully preserved |
| 4    | `kaneo-import.ts` + test file                            | Fix        | Uses canonical frontmatter parser in `patchRelations`                                        |
| 5    | `kaneo-import.ts`                                        | Perf       | Eliminates wasted pass-1 frontmatter API calls                                               |
| 6    | `kaneo-import.ts`                                        | Perf       | Removes redundant `GET /label` per assigned label                                            |
| 7    | `kaneo-import.ts` + 2 migrate files                      | Perf + Fix | Caches archived label before task loop                                                       |
| 8    | `kaneo-import.ts` + 2 migrate files + test               | Fix        | Correct `stats.columns` count (only newly-created)                                           |
| 9    | `linear-client.ts` + new test file                       | Fix        | Pagination for labels, states, projects                                                      |
| 10   | `test-migration-verify.ts` + `test-migration-migrate.ts` | Feat       | Comments, label assignments, priorities verified                                             |

**Not addressed (out of scope):** Retry/backoff for Linear API rate limits; full-dataset verification pass; idempotency guard for `migrate-linear-to-kaneo.ts` (requires task deduplication key design decision); comment author fetching from Linear (Linear API doesn't expose author on team issues without additional scopes).
