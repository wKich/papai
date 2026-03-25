# Timezone Tool-Layer Conversion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move all timezone-aware datetime conversion from the LLM (via system-prompt instructions) to the tool layer; the LLM provides local times as structured objects and tools handle all local→UTC conversion.

**Architecture:** A new `src/utils/datetime.ts` utility wraps `date-fns-tz`'s `fromZonedTime` as `localDatetimeToUtc()` and adds `semanticScheduleToCron()` (structured frequency → cron string). Tool input schemas change to accept local datetime structs and semantic schedules. The system prompt is stripped of all timezone disclosure and conversion instructions — it only provides the current local date/time string for reference.

**Tech Stack:** Bun, TypeScript, Zod v4, [`date-fns`](https://date-fns.org/) + [`date-fns-tz`](https://github.com/marnusw/date-fns-tz) for timezone-aware datetime conversion, existing `cron.ts` patterns.

---

## Pre-work: Understand the existing test signatures

Before touching any code, read these files to understand the current function signatures and what tests will need updating:

- `tests/tools/task-tools.test.ts`
- `tests/tools/recurring-tools.test.ts`
- `tests/deferred-prompts/tools.test.ts`
- `src/tools/index.ts` (how `makeCoreTools` is called)

---

## Task 0: Install `date-fns` and `date-fns-tz`

**Files:**

- Modify: `package.json` (via `bun add`)

### Step 1: Install the dependencies

```
bun add date-fns date-fns-tz
```

`date-fns` is a peer dependency of `date-fns-tz` so both must be installed. `date-fns-tz` v3.x supports `date-fns ^3.x || ^4.x`.

### Step 2: Verify install

```
bun typecheck
```

Expected: no errors (no source files changed yet).

### Step 3: Commit

```
git commit -m "chore: add date-fns and date-fns-tz dependencies"
```

---

## Task 1: Create `src/utils/datetime.ts` with TDD

**Files:**

- Create: `src/utils/datetime.ts`
- Create: `tests/utils/datetime.test.ts`

### Step 1: Write the failing tests

```typescript
// tests/utils/datetime.test.ts
import { describe, expect, test } from 'bun:test'

import { localDatetimeToUtc, semanticScheduleToCron, utcToLocal } from '../../src/utils/datetime.js'

describe('localDatetimeToUtc', () => {
  test('converts date+time in UTC (no offset)', () => {
    expect(localDatetimeToUtc('2026-03-25', '09:00', 'UTC')).toBe('2026-03-25T09:00:00.000Z')
  })

  test('converts date+time for east-of-UTC timezone (UTC+5)', () => {
    // Asia/Karachi is UTC+5, no DST
    // 17:00 local = 12:00 UTC
    expect(localDatetimeToUtc('2026-03-25', '17:00', 'Asia/Karachi')).toBe('2026-03-25T12:00:00.000Z')
  })

  test('converts date-only to local midnight', () => {
    // midnight Karachi (UTC+5) = 19:00 UTC previous day
    expect(localDatetimeToUtc('2026-03-25', undefined, 'Asia/Karachi')).toBe('2026-03-24T19:00:00.000Z')
  })

  test('converts date+time for west-of-UTC timezone (UTC-5)', () => {
    // America/New_York in winter is UTC-5
    // 09:00 NY = 14:00 UTC
    expect(localDatetimeToUtc('2026-01-15', '09:00', 'America/New_York')).toBe('2026-01-15T14:00:00.000Z')
  })

  test('converts date+time for UTC-8 (America/Los_Angeles in standard time)', () => {
    // 2026-01-10 is winter; LA = UTC-8
    expect(localDatetimeToUtc('2026-01-10', '10:00', 'America/Los_Angeles')).toBe('2026-01-10T18:00:00.000Z')
  })

  test('falls back to treating time as UTC when timezone is invalid', () => {
    expect(localDatetimeToUtc('2026-03-25', '09:00', 'Not/ATimezone')).toBe('2026-03-25T09:00:00.000Z')
  })
})

describe('semanticScheduleToCron', () => {
  test('daily', () => {
    expect(semanticScheduleToCron({ frequency: 'daily', time: '09:00' })).toBe('0 9 * * *')
  })

  test('daily with leading-zero hours', () => {
    expect(semanticScheduleToCron({ frequency: 'daily', time: '09:05' })).toBe('5 9 * * *')
  })

  test('weekdays', () => {
    expect(semanticScheduleToCron({ frequency: 'weekdays', time: '09:00' })).toBe('0 9 * * 1-5')
  })

  test('weekends', () => {
    expect(semanticScheduleToCron({ frequency: 'weekends', time: '10:00' })).toBe('0 10 * * 0,6')
  })

  test('weekly on a single day', () => {
    expect(semanticScheduleToCron({ frequency: 'weekly', time: '09:00', days_of_week: ['mon'] })).toBe('0 9 * * 1')
  })

  test('weekly on multiple days', () => {
    expect(semanticScheduleToCron({ frequency: 'weekly', time: '09:00', days_of_week: ['mon', 'wed', 'fri'] })).toBe(
      '0 9 * * 1,3,5',
    )
  })

  test('weekly with no days_of_week defaults to every day', () => {
    expect(semanticScheduleToCron({ frequency: 'weekly', time: '09:00' })).toBe('0 9 * * *')
  })

  test('monthly with explicit day', () => {
    expect(semanticScheduleToCron({ frequency: 'monthly', time: '10:00', day_of_month: 15 })).toBe('0 10 15 * *')
  })

  test('monthly without day defaults to 1st', () => {
    expect(semanticScheduleToCron({ frequency: 'monthly', time: '10:00' })).toBe('0 10 1 * *')
  })
})

describe('utcToLocal', () => {
  test('converts UTC to local time in east-of-UTC timezone', () => {
    // 12:00 UTC = 17:00 Asia/Karachi (UTC+5, no DST)
    expect(utcToLocal('2026-03-25T12:00:00.000Z', 'Asia/Karachi')).toBe('2026-03-25T17:00:00')
  })

  test('converts UTC to local time in west-of-UTC timezone', () => {
    // 14:00 UTC = 09:00 America/New_York in winter (UTC-5)
    expect(utcToLocal('2026-01-15T14:00:00.000Z', 'America/New_York')).toBe('2026-01-15T09:00:00')
  })

  test('returns null for null input', () => {
    expect(utcToLocal(null, 'Asia/Karachi')).toBeNull()
  })

  test('returns undefined for undefined input', () => {
    expect(utcToLocal(undefined, 'Asia/Karachi')).toBeUndefined()
  })

  test('falls back to original string on unparseable input', () => {
    expect(utcToLocal('not-a-date', 'Asia/Karachi')).toBe('not-a-date')
  })
})
```

Run to verify all tests FAIL:

```
bun test tests/utils/datetime.test.ts
```

Expected: all tests fail with "Cannot find module".

### Step 2: Implement `src/utils/datetime.ts`

```typescript
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

export type LocalDatetime = {
  date: string // YYYY-MM-DD
  time?: string // HH:MM (24-hour)
}

export type SemanticSchedule = {
  frequency: 'daily' | 'weekly' | 'monthly' | 'weekdays' | 'weekends'
  time: string // HH:MM (24-hour, user's local timezone)
  days_of_week?: Array<'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'>
  day_of_month?: number
}

const DAY_OF_WEEK_MAP: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
}

/**
 * Convert a local date+time in a named IANA timezone to a UTC ISO string.
 *
 * Uses date-fns-tz `fromZonedTime` which handles DST correctly. Falls back
 * to treating the time as UTC when the timezone identifier is invalid.
 */
export const localDatetimeToUtc = (date: string, time: string | undefined, timezone: string): string => {
  // fromZonedTime accepts "YYYY-MM-DDTHH:MM:SS" as a local datetime string
  const localStr = `${date}T${time ?? '00:00'}:00`
  const utcDate = fromZonedTime(localStr, timezone)

  if (Number.isNaN(utcDate.getTime())) {
    // Invalid timezone — treat as UTC
    return new Date(`${localStr}Z`).toISOString()
  }

  return utcDate.toISOString()
}

/**
 * Convert a semantic schedule description to a 5-field cron expression.
 *
 * The time is expressed in the user's local timezone. The cron expression is
 * stored alongside the user's IANA timezone in the recurring_tasks table, and
 * cron.ts evaluates it in that timezone (via getLocalParts / Intl.DateTimeFormat).
 * No UTC conversion is applied here.
 */
export const semanticScheduleToCron = (schedule: SemanticSchedule): string => {
  const [hourStr, minuteStr] = schedule.time.split(':')
  const h = Number.parseInt(hourStr ?? '0', 10)
  const m = Number.parseInt(minuteStr ?? '0', 10)

  switch (schedule.frequency) {
    case 'daily':
      return `${m} ${h} * * *`
    case 'weekdays':
      return `${m} ${h} * * 1-5`
    case 'weekends':
      return `${m} ${h} * * 0,6`
    case 'weekly': {
      const days = schedule.days_of_week
      if (days === undefined || days.length === 0) return `${m} ${h} * * *`
      const dow = days.map((d) => DAY_OF_WEEK_MAP[d]).join(',')
      return `${m} ${h} * * ${dow}`
    }
    case 'monthly': {
      const dom = schedule.day_of_month ?? 1
      return `${m} ${h} ${dom} * *`
    }
  }
}

/**
 * Convert a UTC ISO string to a naive local datetime string ("YYYY-MM-DDTHH:MM:SS")
 * for display back to the LLM. No Z suffix — signals local time.
 *
 * Returns null/undefined unchanged. Falls back to the original string
 * when the input cannot be parsed.
 */
export const utcToLocal = (utcIso: string | null | undefined, timezone: string): string | null | undefined => {
  if (utcIso === null || utcIso === undefined) return utcIso
  try {
    return formatInTimeZone(new Date(utcIso), timezone, "yyyy-MM-dd'T'HH:mm:ss")
  } catch {
    return utcIso
  }
}
```

### Step 3: Run tests to verify all pass

```
bun test tests/utils/datetime.test.ts
```

Expected: all 19 tests pass.

### Step 4: Typecheck

```
bun typecheck
```

Expected: no errors.

### Step 5: Commit

```
git commit -m "feat(utils): add localDatetimeToUtc, semanticScheduleToCron, and utcToLocal utilities"
```

---

## Task 2: Update `create-task.ts` to accept structured `dueDate` (TDD)

**Files:**

- Modify: `src/tools/create-task.ts`
- Modify: `tests/tools/task-tools.test.ts`

### Step 1: Add mock for `config` and write failing test

Add near the top of `tests/tools/task-tools.test.ts` (before the import of `create-task.ts`):

```typescript
// Mock config to return a test timezone
void mock.module('../../src/config.js', () => ({
  getConfig: (userId: string, key: string) => {
    if (key === 'timezone') return 'Asia/Karachi' // UTC+5 for predictable offset tests
    return null
  },
}))
```

Then add a test inside `describe('makeCreateTaskTool')`:

```typescript
test('converts structured dueDate from local time to UTC before calling provider', async () => {
  let capturedDueDate: string | undefined
  const provider = createMockProvider({
    createTask: mock((input: { dueDate?: string; title: string; status: string }) => {
      capturedDueDate = input.dueDate
      return Promise.resolve({ id: 'task-1', title: input.title, status: 'todo', url: '' })
    }),
  })

  const tool = makeCreateTaskTool(provider, 'user-1')
  if (!tool.execute) throw new Error('Tool execute is undefined')
  await tool.execute(
    { title: 'Test', projectId: 'p1', dueDate: { date: '2026-03-25', time: '17:00' } },
    { toolCallId: '1', messages: [] },
  )

  // 17:00 Karachi (UTC+5) = 12:00 UTC
  expect(capturedDueDate).toBe('2026-03-25T12:00:00.000Z')
})

test('omits dueDate when not provided', async () => {
  let capturedDueDate: string | undefined = 'sentinel'
  const provider = createMockProvider({
    createTask: mock((input: { dueDate?: string; title: string }) => {
      capturedDueDate = input.dueDate
      return Promise.resolve({ id: 'task-1', title: input.title, status: 'todo', url: '' })
    }),
  })

  const tool = makeCreateTaskTool(provider, 'user-1')
  if (!tool.execute) throw new Error('Tool execute is undefined')
  await tool.execute({ title: 'No date', projectId: 'p1' }, { toolCallId: '1', messages: [] })

  expect(capturedDueDate).toBeUndefined()
})

test('returns dueDate converted back to user local time (UTC→local)', async () => {
  const provider = createMockProvider({
    createTask: mock(() =>
      Promise.resolve({
        id: 'task-1',
        title: 'Test',
        status: 'todo',
        url: '',
        dueDate: '2026-03-25T12:00:00.000Z', // UTC stored by provider
      }),
    ),
  })

  const tool = makeCreateTaskTool(provider, 'user-1')
  if (!tool.execute) throw new Error('Tool execute is undefined')
  const result = await tool.execute(
    { title: 'Test', projectId: 'p1', dueDate: { date: '2026-03-25', time: '17:00' } },
    { toolCallId: '1', messages: [] },
  )

  // Provider echoed back UTC; tool should convert to Asia/Karachi local time (UTC+5)
  expect(result).toHaveProperty('dueDate', '2026-03-25T17:00:00')
})
```

Run to verify FAIL:

```
bun test tests/tools/task-tools.test.ts
```

### Step 2: Modify `src/tools/create-task.ts`

Replace the current `dueDate` schema field and add `userId` parameter:

```typescript
import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { getConfig } from '../config.js'
import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'
import { localDatetimeToUtc, utcToLocal } from '../utils/datetime.js'

const log = logger.child({ scope: 'tool:create-task' })

export function makeCreateTaskTool(provider: TaskProvider, userId?: string): ToolSet[string] {
  return tool({
    description: 'Create a new task. Call list_projects first to get a valid projectId.',
    inputSchema: z.object({
      title: z.string().describe('Short, descriptive task title'),
      description: z.string().optional().describe('Detailed description of the task'),
      priority: z.enum(['no-priority', 'low', 'medium', 'high', 'urgent']).optional().describe('Priority level'),
      projectId: z.string().describe('Project ID — call list_projects first to obtain this'),
      dueDate: z
        .object({
          date: z.string().describe("Date in YYYY-MM-DD format (user's local date)"),
          time: z.string().optional().describe("Time in HH:MM 24-hour format (user's local time)"),
        })
        .optional()
        .describe("Due date in the user's local time — tool converts to UTC"),
      status: z.string().optional().describe("Status column slug (e.g. 'to-do', 'in-progress', 'done')"),
    }),
    execute: async ({ title, description, priority, projectId, dueDate, status }) => {
      try {
        const timezone = userId !== undefined ? (getConfig(userId, 'timezone') ?? 'UTC') : 'UTC'
        const resolvedDueDate =
          dueDate !== undefined ? localDatetimeToUtc(dueDate.date, dueDate.time, timezone) : undefined

        const task = await provider.createTask({
          projectId,
          title,
          description,
          priority,
          status,
          dueDate: resolvedDueDate,
        })
        log.info({ taskId: task.id, title }, 'Task created via tool')
        // Convert UTC dueDate back to local time before returning to LLM
        return { ...task, dueDate: utcToLocal(task.dueDate, timezone) }
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), title, tool: 'create_task' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
```

### Step 3: Run tests to verify pass

```
bun test tests/tools/task-tools.test.ts
```

### Step 4: Typecheck

```
bun typecheck
```

### Step 5: Commit

```
git commit -m "feat(tools): accept structured dueDate in create-task and convert local time to UTC"
```

---

## Task 3: Update `update-task.ts` to accept structured `dueDate` (TDD)

**Files:**

- Modify: `src/tools/update-task.ts`
- Modify: `tests/tools/task-tools.test.ts`

### Step 1: Write failing test

Add to `describe('makeUpdateTaskTool')` in `tests/tools/task-tools.test.ts`:

```typescript
test('converts structured dueDate to UTC when updating task', async () => {
  let capturedDueDate: string | undefined
  const provider = createMockProvider({
    updateTask: mock((_id: string, updates: { dueDate?: string }) => {
      capturedDueDate = updates.dueDate
      return Promise.resolve({ id: 'task-1', title: 'Test', status: 'todo', url: '' })
    }),
  })

  const tool = makeUpdateTaskTool(provider, undefined, 'user-1')
  if (!tool.execute) throw new Error('Tool execute is undefined')
  await tool.execute(
    { taskId: 'task-1', dueDate: { date: '2026-03-25', time: '17:00' } },
    { toolCallId: '1', messages: [] },
  )

  // 17:00 Karachi (UTC+5) = 12:00 UTC
  expect(capturedDueDate).toBe('2026-03-25T12:00:00.000Z')
})

test('returns dueDate converted back to user local time (UTC→local)', async () => {
  const provider = createMockProvider({
    updateTask: mock(() =>
      Promise.resolve({
        id: 'task-1',
        title: 'Test',
        status: 'todo',
        url: '',
        dueDate: '2026-03-25T12:00:00.000Z', // UTC stored by provider
      }),
    ),
  })

  const tool = makeUpdateTaskTool(provider, undefined, 'user-1')
  if (!tool.execute) throw new Error('Tool execute is undefined')
  const result = await tool.execute(
    { taskId: 'task-1', dueDate: { date: '2026-03-25', time: '17:00' } },
    { toolCallId: '1', messages: [] },
  )

  // Provider echoed back UTC; tool should convert to Asia/Karachi local time (UTC+5)
  expect(result).toHaveProperty('dueDate', '2026-03-25T17:00:00')
})
```

Run to verify FAIL:

```
bun test tests/tools/task-tools.test.ts
```

### Step 2: Modify `src/tools/update-task.ts`

Apply the same pattern as `create-task.ts`: add `userId` third parameter, change `dueDate` schema to structured object, add conversion in `execute`.

Key signature change: `makeUpdateTaskTool(provider: TaskProvider, completionHook?: CompletionHookFn, userId?: string)`.

The `dueDate` schema becomes:

```typescript
dueDate: z
  .object({
    date: z.string().describe("Date in YYYY-MM-DD format (user's local date)"),
    time: z.string().optional().describe("Time in HH:MM 24-hour format (user's local time)"),
  })
  .optional()
  .describe("Due date in the user's local time — tool converts to UTC"),
```

And in `execute`, compute timezone once to use for both input and output conversion:

```typescript
const timezone = userId !== undefined ? (getConfig(userId, 'timezone') ?? 'UTC') : 'UTC'
const resolvedDueDate = dueDate !== undefined ? localDatetimeToUtc(dueDate.date, dueDate.time, timezone) : undefined
```

Return the updated task with `dueDate` converted back to local:

```typescript
return { ...task, dueDate: utcToLocal(task.dueDate, timezone) }
```

Import `getConfig`, `localDatetimeToUtc`, and `utcToLocal` at the top.

### Step 3: Run tests to verify pass

```
bun test tests/tools/task-tools.test.ts
```

### Step 4: Typecheck

```
bun typecheck
```

### Step 5: Commit

```
git commit -m "feat(tools): accept structured dueDate in update-task and convert local time to UTC"
```

---

## Task 4: Update `src/tools/index.ts` to pass `userId` to core tools

**Files:**

- Modify: `src/tools/index.ts`

### Step 1: Update `makeCoreTools` and its call site

Change `makeCoreTools` signature from `(provider: TaskProvider)` to `(provider: TaskProvider, userId?: string)`:

```typescript
function makeCoreTools(provider: TaskProvider, userId?: string): ToolSet {
  return {
    create_task: makeCreateTaskTool(provider, userId),
    update_task: makeUpdateTaskTool(provider, completionHook, userId),
    search_tasks: makeSearchTasksTool(provider),
    list_tasks: makeListTasksTool(provider, userId),
    get_task: makeGetTaskTool(provider, userId),
  }
}
```

Then in `makeTools`:

```typescript
export function makeTools(provider: TaskProvider, userId?: string): ToolSet {
  const tools = makeCoreTools(provider, userId) // was: makeCoreTools(provider)
  // ... rest unchanged
}
```

### Step 2: Typecheck

```
bun typecheck
```

Expected: no errors.

### Step 3: Run full unit test suite

```
bun test
```

Expected: all existing tests pass.

### Step 4: Commit

```
git commit -m "refactor(tools): thread userId through makeCoreTools for timezone-aware dueDate conversion"
```

---

## Task 4a: Convert UTC `dueDate` to local time in `get-task.ts` and `list-tasks.ts` (TDD)

**Files:**

- Modify: `src/tools/get-task.ts`
- Modify: `src/tools/list-tasks.ts`
- Modify: `tests/tools/task-tools.test.ts`

**Why:** These tools return full `Task` objects containing `dueDate` (and `createdAt`) as UTC strings from the provider. The LLM must always see local time. Without converting these fields, the LLM would receive UTC strings from `get_task` and `list_tasks` while receiving local time from `create_task` and `update_task` — inconsistent and confusing.

**Key insight:** `get-task.ts` and `list-tasks.ts` do not currently accept `userId`. They must be updated to accept it so they can look up the user's configured timezone.

### Step 1: Write failing tests

In `tests/tools/task-tools.test.ts`, add inside `describe('makeGetTaskTool')`:

```typescript
test('returns dueDate converted to user local time', async () => {
  const provider = createMockProvider({
    getTask: mock(() =>
      Promise.resolve({
        id: 'task-1',
        title: 'Test',
        status: 'todo',
        url: '',
        dueDate: '2026-03-25T12:00:00.000Z', // UTC from provider
      }),
    ),
  })

  const tool = makeGetTaskTool(provider, 'user-1')
  if (!tool.execute) throw new Error('Tool execute is undefined')
  const result = await tool.execute({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })

  // Asia/Karachi is UTC+5: 12:00 UTC → 17:00 local
  expect(result).toHaveProperty('dueDate', '2026-03-25T17:00:00')
})
```

Add inside `describe('makeListTasksTool')`:

```typescript
test('returns dueDate fields converted to user local time', async () => {
  const provider = createMockProvider({
    listTasks: mock(() =>
      Promise.resolve([
        { id: 'task-1', title: 'A', status: 'todo', url: '', dueDate: '2026-03-25T12:00:00.000Z' },
        { id: 'task-2', title: 'B', status: 'todo', url: '', dueDate: undefined },
      ]),
    ),
  })

  const tool = makeListTasksTool(provider, 'user-1')
  if (!tool.execute) throw new Error('Tool execute is undefined')
  const result = await tool.execute({ projectId: 'p1' }, { toolCallId: '1', messages: [] })

  const tasks = result as Array<{ dueDate?: string }>
  expect(tasks[0]).toHaveProperty('dueDate', '2026-03-25T17:00:00')
  expect(tasks[1]).toHaveProperty('dueDate', undefined)
})
```

Run to verify FAIL:

```
bun test tests/tools/task-tools.test.ts
```

### Step 2: Update `src/tools/get-task.ts`

Add `userId?: string` parameter to `makeGetTaskTool`. Import `getConfig` and `utcToLocal`. In `execute`, convert `dueDate` before returning:

```typescript
import { getConfig } from '../config.js'
import { utcToLocal } from '../utils/datetime.js'

export function makeGetTaskTool(provider: TaskProvider, userId?: string): ToolSet[string] {
  return tool({
    // ...schema unchanged...
    execute: async ({ taskId }) => {
      const task = await provider.getTask(taskId)
      if (task === null) return { error: `Task ${taskId} not found` }
      const timezone = userId !== undefined ? (getConfig(userId, 'timezone') ?? 'UTC') : 'UTC'
      return { ...task, dueDate: utcToLocal(task.dueDate, timezone) }
    },
  })
}
```

### Step 3: Update `src/tools/list-tasks.ts`

Same pattern — add `userId` param, convert each task's `dueDate`:

```typescript
import { getConfig } from '../config.js'
import { utcToLocal } from '../utils/datetime.js'

export function makeListTasksTool(provider: TaskProvider, userId?: string): ToolSet[string] {
  return tool({
    // ...schema unchanged...
    execute: async (input) => {
      const tasks = await provider.listTasks(input)
      const timezone = userId !== undefined ? (getConfig(userId, 'timezone') ?? 'UTC') : 'UTC'
      return tasks.map((task) => ({ ...task, dueDate: utcToLocal(task.dueDate, timezone) }))
    },
  })
}
```

### Step 4: Run tests to verify pass

```
bun test tests/tools/task-tools.test.ts
```

### Step 5: Typecheck

```
bun typecheck
```

### Step 6: Commit

```
git commit -m "feat(tools): convert UTC dueDate to local time in get-task and list-tasks tool returns"
```

---

## Task 5: Replace `cronExpression` with semantic `schedule` in `create-recurring-task.ts` (TDD)

**Files:**

- Modify: `src/tools/create-recurring-task.ts`
- Modify: `tests/tools/recurring-tools.test.ts`

### Step 1: Write failing test

In `tests/tools/recurring-tools.test.ts`, find the existing `describe('makeCreateRecurringTaskTool')` block and add:

```typescript
test('converts semantic schedule to cron expression', async () => {
  // Reset call count tracking
  createRecurringTaskCallCount = 0
  let capturedInput: RecurringTaskInput | null = null

  // Override the mock temporarily to capture input
  void mock.module('../../src/recurring.js', () => ({
    ...existingMocks,
    createRecurringTask: (input: RecurringTaskInput): RecurringTaskRecord => {
      capturedInput = input
      createRecurringTaskCallCount++
      return { ...defaultRecord, triggerType: input.triggerType, cronExpression: input.cronExpression ?? null }
    },
  }))

  import { makeCreateRecurringTaskTool } from '../../src/tools/create-recurring-task.js'
  const tool = makeCreateRecurringTaskTool('user-1')
  if (!tool.execute) throw new Error('execute undefined')

  await tool.execute(
    {
      title: 'Weekly standup',
      projectId: 'p1',
      triggerType: 'cron',
      schedule: { frequency: 'weekly', time: '09:00', days_of_week: ['mon'] },
    },
    { toolCallId: '1', messages: [] },
  )

  expect(capturedInput?.cronExpression).toBe('0 9 * * 1')
})

test('returns error when triggerType is cron but no schedule provided', async () => {
  const tool = makeCreateRecurringTaskTool('user-1')
  if (!tool.execute) throw new Error('execute undefined')

  const result = await tool.execute(
    { title: 'x', projectId: 'p1', triggerType: 'cron' },
    { toolCallId: '1', messages: [] },
  )

  expect(result).toHaveProperty('error')
})
```

Run to verify FAIL:

```
bun test tests/tools/recurring-tools.test.ts
```

### Step 2: Modify `src/tools/create-recurring-task.ts`

Replace the `cronExpression` field in `inputSchema` with a `schedule` object and update `executeCreate`:

**Old schema field:**

```typescript
cronExpression: z
  .string()
  .optional()
  .describe("5-field cron (min hr dom mon dow). Required for 'cron'. E.g. '0 9 * * 1'"),
```

**New schema field:**

```typescript
schedule: z
  .object({
    frequency: z
      .enum(['daily', 'weekly', 'monthly', 'weekdays', 'weekends'])
      .describe('How often the task repeats'),
    time: z.string().describe("Time of day in HH:MM 24-hour format (user's local time)"),
    days_of_week: z
      .array(z.enum(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']))
      .optional()
      .describe('Which days for weekly frequency (e.g. ["mon", "wed", "fri"])'),
    day_of_month: z
      .number()
      .int()
      .min(1)
      .max(31)
      .optional()
      .describe('Day of month for monthly frequency (1–31)'),
  })
  .optional()
  .describe("Schedule configuration for 'cron' triggerType"),
```

**Updated `executeCreate`:**

```typescript
function executeCreate(userId: string, input: Input): unknown {
  log.debug({ userId, title: input.title, triggerType: input.triggerType }, 'Creating recurring task')

  if (input.triggerType === 'cron' && input.schedule === undefined) {
    return { error: "schedule is required when triggerType is 'cron'" }
  }

  const timezone = getConfig(userId, 'timezone') ?? 'UTC'

  const cronExpression =
    input.triggerType === 'cron' && input.schedule !== undefined ? semanticScheduleToCron(input.schedule) : undefined

  const record = createRecurringTask({
    userId,
    title: input.title,
    projectId: input.projectId,
    description: input.description,
    priority: input.priority,
    status: input.status,
    assignee: input.assignee,
    labels: input.labels,
    triggerType: input.triggerType satisfies TriggerType,
    cronExpression,
    catchUp: input.catchUp,
    timezone,
  })

  // ... describeCron call stays the same

  // Convert nextRun UTC→local using record.timezone (frozen at creation time)
  return {
    id: record.id,
    title: record.title,
    projectId: record.projectId,
    triggerType: record.triggerType,
    schedule,
    nextRun: utcToLocal(record.nextRun, record.timezone),
    enabled: record.enabled,
  }
}
```

Add `utcToLocal` to the import from `'../utils/datetime.js'`.

Add a test verifying the returned `nextRun` is in local time:

```typescript
test('returns nextRun converted to user local time', async () => {
  // Mock createRecurringTask to return a known UTC nextRun
  mockCreateRecurringTask = () => ({
    ...defaultRecord,
    timezone: 'Asia/Karachi',
    nextRun: '2026-03-25T12:00:00.000Z', // UTC
  })

  const tool = makeCreateRecurringTaskTool('user-1')
  if (!tool.execute) throw new Error('execute undefined')
  const result = await tool.execute(
    { title: 'Daily', projectId: 'p1', triggerType: 'cron', schedule: { frequency: 'daily', time: '17:00' } },
    { toolCallId: '1', messages: [] },
  )

  expect(result).toHaveProperty('nextRun', '2026-03-25T17:00:00') // Asia/Karachi (UTC+5)
})
```

````

Add import at top:

```typescript
import { semanticScheduleToCron } from '../utils/datetime.js'
````

Remove the `parseCron` import if no longer used (check — `parseCron` was used for validation; with semantic schedules that validation is no longer needed at tool level since `semanticScheduleToCron` always produces a valid cron).

### Step 3: Run tests to verify pass

```
bun test tests/tools/recurring-tools.test.ts
```

### Step 4: Typecheck

```
bun typecheck
```

### Step 5: Commit

```
git commit -m "feat(tools): replace raw cronExpression with semantic schedule in create-recurring-task"
```

---

## Task 6: Replace `cronExpression` with semantic `schedule` in `update-recurring-task.ts` (TDD)

**Files:**

- Modify: `src/tools/update-recurring-task.ts`
- Modify: `tests/tools/recurring-tools.test.ts`

### Step 1: Write failing test

Add to `describe('makeUpdateRecurringTaskTool')`:

```typescript
test('converts semantic schedule to cronExpression when updating', async () => {
  updateRecurringTaskResult = {
    id: 'rec-1',
    userId: 'user-1',
    projectId: 'p1',
    title: 'Test',
    description: null,
    priority: null,
    status: null,
    assignee: null,
    labels: [],
    triggerType: 'cron',
    cronExpression: '0 9 * * 1',
    timezone: 'UTC',
    enabled: true,
    catchUp: false,
    lastRun: null,
    nextRun: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  const tool = makeUpdateRecurringTaskTool()
  if (!tool.execute) throw new Error('execute undefined')

  await tool.execute(
    {
      recurringTaskId: 'rec-1',
      schedule: { frequency: 'weekly', time: '09:00', days_of_week: ['mon'] },
    },
    { toolCallId: '1', messages: [] },
  )

  // Should have been called with cronExpression, not raw schedule
  expect(updateRecurringTaskCalls[0]?.updates).toHaveProperty('cronExpression', '0 9 * * 1')
})
```

Run to verify FAIL:

```
bun test tests/tools/recurring-tools.test.ts
```

### Step 2: Modify `src/tools/update-recurring-task.ts`

Replace `cronExpression` in `inputSchema` with the same `schedule` object from Task 5.

In `execute`:

```typescript
execute: ({ recurringTaskId, title, description, priority, status, assignee, labels, schedule, catchUp }) => {
  try {
    log.debug({ recurringTaskId }, 'Updating recurring task')

    const cronExpression =
      schedule !== undefined ? semanticScheduleToCron(schedule) : undefined

    const updated = updateRecurringTask(recurringTaskId, {
      title,
      description,
      priority,
      status,
      assignee,
      labels,
      cronExpression,
      catchUp,
    })

    // Convert nextRun UTC→local using the timezone stored on the record itself
    return {
      id: updated.id,
      title: updated.title,
      projectId: updated.projectId,
      enabled: updated.enabled,
      nextRun: utcToLocal(updated.nextRun, updated.timezone),
    }
    // ... rest unchanged
  }
}
```

Add `utcToLocal` to the import from `'../utils/datetime.js'`.

Add a test verifying the returned `nextRun` is in local time:

```typescript
test('returns nextRun converted to user local time', async () => {
  updateRecurringTaskResult = {
    ...defaultRecord,
    timezone: 'Asia/Karachi',
    nextRun: '2026-03-25T12:00:00.000Z', // UTC
  }

  const tool = makeUpdateRecurringTaskTool()
  if (!tool.execute) throw new Error('execute undefined')
  const result = await tool.execute({ recurringTaskId: 'rec-1', title: 'Updated' }, { toolCallId: '1', messages: [] })

  expect(result).toHaveProperty('nextRun', '2026-03-25T17:00:00') // Asia/Karachi (UTC+5)
})
```

### Step 3: Run tests to verify pass

```
bun test tests/tools/recurring-tools.test.ts
```

### Step 4: Commit

```
git commit -m "feat(tools): replace raw cronExpression with semantic schedule in update-recurring-task"
```

---

## Task 6a: Convert UTC `nextRun`/`lastRun` to local time in list, resume, and skip recurring task tools (TDD)

**Files:**

- Modify: `src/tools/list-recurring-tasks.ts`
- Modify: `src/tools/resume-recurring-task.ts`
- Modify: `src/tools/skip-recurring-task.ts`
- Modify: `tests/tools/recurring-tools.test.ts`

**Why:** These three tools return `nextRun` and/or `lastRun` as UTC strings but are not touched in any earlier task. The LLM would receive UTC timestamps for these operations while seeing local time for create and update — inconsistent and confusing. The clean path: use `task.timezone` which is stored on each recurring task record (no config lookup needed).

### Step 1: Write failing tests

Add inside each relevant describe block in `tests/tools/recurring-tools.test.ts`:

```typescript
// In describe('makeListRecurringTasksTool')
test('returns nextRun and lastRun converted to user local time', async () => {
  listRecurringTasksResult = [
    {
      ...defaultRecord,
      timezone: 'Asia/Karachi',
      nextRun: '2026-03-25T12:00:00.000Z', // UTC
      lastRun: '2026-03-24T12:00:00.000Z', // UTC
    },
  ]

  const tool = makeListRecurringTasksTool()
  if (!tool.execute) throw new Error('execute undefined')
  const result = await tool.execute({}, { toolCallId: '1', messages: [] })

  const tasks = result as Array<{ nextRun?: string; lastRun?: string }>
  expect(tasks[0]).toHaveProperty('nextRun', '2026-03-25T17:00:00')
  expect(tasks[0]).toHaveProperty('lastRun', '2026-03-24T17:00:00')
})

// In describe('makeResumeRecurringTaskTool')
test('returns nextRun converted to user local time after resume', async () => {
  resumeRecurringTaskResult = {
    ...defaultRecord,
    timezone: 'Asia/Karachi',
    nextRun: '2026-03-25T12:00:00.000Z', // UTC
  }

  const tool = makeResumeRecurringTaskTool()
  if (!tool.execute) throw new Error('execute undefined')
  const result = await tool.execute({ recurringTaskId: 'rec-1' }, { toolCallId: '1', messages: [] })

  expect(result).toHaveProperty('nextRun', '2026-03-25T17:00:00')
})

// In describe('makeSkipRecurringTaskTool')
test('returns nextRun converted to user local time after skip', async () => {
  skipRecurringTaskResult = {
    ...defaultRecord,
    timezone: 'Asia/Karachi',
    nextRun: '2026-03-25T12:00:00.000Z', // UTC
  }

  const tool = makeSkipRecurringTaskTool()
  if (!tool.execute) throw new Error('execute undefined')
  const result = await tool.execute({ recurringTaskId: 'rec-1' }, { toolCallId: '1', messages: [] })

  expect(result).toHaveProperty('nextRun', '2026-03-25T17:00:00')
})
```

Run to verify FAIL:

```
bun test tests/tools/recurring-tools.test.ts
```

### Step 2: Update `src/tools/list-recurring-tasks.ts`

Import `utcToLocal` and wrap each task's `nextRun` and `lastRun` in the return:

```typescript
import { utcToLocal } from '../utils/datetime.js'

// In execute:
return tasks.map((task) => ({
  ...task,
  nextRun: utcToLocal(task.nextRun, task.timezone),
  lastRun: utcToLocal(task.lastRun, task.timezone),
}))
```

### Step 3: Update `src/tools/resume-recurring-task.ts`

Import `utcToLocal`. In the return value, wrap `nextRun`:

```typescript
import { utcToLocal } from '../utils/datetime.js'

// In execute return:
return {
  ...updated,
  nextRun: utcToLocal(updated.nextRun, updated.timezone),
}
```

### Step 4: Update `src/tools/skip-recurring-task.ts`

Same pattern as `resume-recurring-task.ts`.

### Step 5: Run tests to verify pass

```
bun test tests/tools/recurring-tools.test.ts
```

### Step 6: Typecheck

```
bun typecheck
```

### Step 7: Commit

```
git commit -m "feat(tools): convert UTC nextRun/lastRun to local time in list, resume, and skip recurring task returns"
```

---

## Task 7: Update deferred prompts `fire_at` to local datetime (TDD)

**Files:**

- Modify: `src/deferred-prompts/tools.ts`
- Modify: `tests/deferred-prompts/tools.test.ts`

### Step 1: Read current `fire_at` tests

Before touching anything, read `tests/deferred-prompts/tools.test.ts` in full to understand which tests use `fire_at`.

### Step 2: Write failing tests

In `tests/deferred-prompts/tools.test.ts`, update the existing `fire_at` test and add a new UTC conversion test:

```typescript
test('creates one-time scheduled prompt with structured fire_at (local time → UTC)', async () => {
  // Set user timezone to UTC+5 (Karachi)
  setConfig(USER_ID, 'timezone', 'Asia/Karachi')

  const t = getTools()['create_deferred_prompt']!
  if (!t.execute) throw new Error('Tool execute is undefined')

  // 17:00 tomorrow Karachi time
  const tomorrowDate = new Date()
  tomorrowDate.setDate(tomorrowDate.getDate() + 1)
  const dateStr = tomorrowDate.toISOString().slice(0, 10) // YYYY-MM-DD

  const result: unknown = await t.execute(
    { prompt: 'Remind me', schedule: { fire_at: { date: dateStr, time: '17:00' } } },
    toolCtx,
  )

  expect(result).toHaveProperty('status', 'created')
  expect(result).toHaveProperty('type', 'scheduled')
  // The stored fireAt should be 12:00 UTC (17:00 - 5h offset)
  expect(result).toHaveProperty('fireAt')
  const { fireAt } = result as { fireAt: string }
  expect(new Date(fireAt).getUTCHours()).toBe(12)
})

test('creates with cron-only schedule (cron is unchanged — no UTC conversion for cron)', async () => {
  // This test should still pass (cron stays as-is)
  const t = getTools()['create_deferred_prompt']!
  if (!t.execute) throw new Error('Tool execute is undefined')
  const result: unknown = await t.execute({ prompt: 'Daily', schedule: { cron: '0 9 * * *' } }, toolCtx)
  expect(result).toHaveProperty('status', 'created')
  expect(result).toHaveProperty('cronExpression', '0 9 * * *')
})
```

Run to verify FAIL:

```
bun test tests/deferred-prompts/tools.test.ts
```

### Step 3: Update `fire_at` schema in `src/deferred-prompts/tools.ts`

Change the `fire_at` field in `scheduleSchema` from `z.string()` to a structured object:

**Old:**

```typescript
fire_at: z.string().optional().describe("ISO 8601 timestamp for a one-time trigger (must be in the future)"),
```

**New:**

```typescript
fire_at: z
  .object({
    date: z.string().describe("Date in YYYY-MM-DD format (user's local date)"),
    time: z.string().describe("Time in HH:MM 24-hour format (user's local time)"),
  })
  .optional()
  .describe("One-time trigger date and time in user's local time — tool handles UTC conversion"),
```

Update `createScheduled` function to use `localDatetimeToUtc`:

```typescript
function createScheduled(userId: string, prompt: string, schedule: ScheduleInput): CreateResult {
  const hasFireAt = schedule.fire_at !== undefined
  const hasCron = schedule.cron !== undefined && schedule.cron !== ''

  if (hasFireAt) {
    const { date, time } = schedule.fire_at!
    const timezone = getConfig(userId, 'timezone') ?? 'UTC'
    const utcStr = localDatetimeToUtc(date, time, timezone)
    const fireDate = new Date(utcStr)
    if (Number.isNaN(fireDate.getTime())) return { error: `Invalid fire_at date/time: '${date}T${time}'` }
    if (fireDate.getTime() <= Date.now()) return { error: 'fire_at must be a future date and time.' }
    // ... continue with fireAt = utcStr
  }
  // ... rest unchanged
}
```

Update the `ScheduleInput` type:

```typescript
type ScheduleInput = { fire_at?: { date: string; time: string }; cron?: string }
```

Add import:

```typescript
import { localDatetimeToUtc, utcToLocal } from '../utils/datetime.js'
```

**D. Convert `fireAt` back to local time in all return values**

The `createScheduled` function currently returns a plain object with `fireAt` as a UTC string. The LLM needs to see local time in all tool responses. After storing the scheduled prompt, convert `fireAt` before returning:

```typescript
// In createScheduled return (one-time scheduled prompt):
return {
  status: 'created',
  type: 'scheduled',
  id: result.id,
  fireAt: utcToLocal(result.fireAt, getConfig(userId, 'timezone') ?? 'UTC'),
  cronExpression: undefined,
}
```

For `list_deferred_prompts` and `get_deferred_prompt` tool returns, wrap all datetime fields:

```typescript
// When mapping ScheduledPrompt objects to return value:
const timezone = getConfig(userId, 'timezone') ?? 'UTC'
return prompts.map((p) => ({
  ...p,
  fireAt: utcToLocal(p.fireAt, timezone),
  createdAt: utcToLocal(p.createdAt, timezone),
  lastExecutedAt: utcToLocal(p.lastExecutedAt, timezone),
  lastTriggeredAt: utcToLocal(p.lastTriggeredAt, timezone), // alert prompts
}))
```

Add a new test confirming the `createScheduled` return has `fireAt` in local time:

```typescript
test('returned fireAt is in user local time (UTC\u2192local)', async () => {
  // Mock the storage to return a UTC fireAt
  mockCreateScheduledPrompt = () => ({
    id: 'sp-1',
    fireAt: '2026-03-25T12:00:00.000Z', // UTC stored
    cronExpression: null,
    prompt: 'x',
    userId: USER_ID,
    createdAt: new Date().toISOString(),
    lastExecutedAt: null,
  })

  const t = getTools()['create_deferred_prompt']!
  if (!t.execute) throw new Error('Tool execute is undefined')
  const result = await t.execute({ prompt: 'x', schedule: { fire_at: { date: '2026-03-25', time: '17:00' } } }, toolCtx)

  // fireAt in result should be local (Asia/Karachi = UTC+5 → 17:00)
  expect(result).toHaveProperty('fireAt', '2026-03-25T17:00:00')
})
```

### Step 4: Run tests

```
bun test tests/deferred-prompts/tools.test.ts
```

### Step 5: Typecheck

```
bun typecheck
```

### Step 6: Commit

```
git commit -m "feat(deferred-prompts): accept local datetime for fire_at; convert to UTC in tool"
```

---

## Task 8: Simplify `buildBasePrompt` in `llm-orchestrator.ts`

**Files:**

- Modify: `src/llm-orchestrator.ts`

### Step 1: Read the current prompt sections carefully

Before editing, re-read `src/llm-orchestrator.ts` lines 25–160 (the full `buildBasePrompt` function) to know exactly what to change.

### Step 2: Apply the changes

**A. Remove timezone disclosure from the prompt header**

Old:

```typescript
return `You are papai, a personal assistant that helps the user manage their tasks.
Current date and time: ${localDate} (${timezone}).
User timezone: ${timezone}.
```

New:

```typescript
return `You are papai, a personal assistant that helps the user manage their tasks.
Current date and time: ${localDate}.
```

**B. Replace the DUE DATES section**

Old:

```
DUE DATES — When the user mentions a due date or time:
- Always interpret dates and times in the user's timezone (${timezone}).
- Convert to ISO 8601 format for tool calls (e.g. '2026-03-15' for date-only, '2026-03-15T17:00:00' for date+time).
- "tomorrow at 5pm" means 5pm in ${timezone}, not UTC.
- "end of day" means 23:59 in ${timezone}.
- "next Monday" means the next Monday in ${timezone}.
```

New:

```
DUE DATES — When the user mentions a due date or time:
- Express dates as { date: "YYYY-MM-DD" } and times as { time: "HH:MM" } in 24-hour local time — the tool handles UTC conversion.
- "tomorrow at 5pm" → dueDate: { date: "YYYY-MM-DD", time: "17:00" } (tomorrow's date).
- "end of day" → dueDate: { date: "YYYY-MM-DD", time: "23:59" }.
- "next Monday" → dueDate: { date: "YYYY-MM-DD" } (date only, no time field).
```

**C. Replace the RECURRING TASKS section**

Old:

```
RECURRING TASKS — The user can set up tasks that repeat automatically:
- "cron" trigger: task is created on a fixed schedule (cron expression). Cron times are interpreted in the user's timezone (${timezone}). Use create_recurring_task with triggerType "cron" and a cronExpression.
- "on_complete" trigger: creates the next task only after the current one is marked done. Use triggerType "on_complete" (no cronExpression needed).
- Common cron patterns: "0 9 * * 1" = every Monday 9am, "0 9 * * 1-5" = weekdays 9am, "0 0 1 * *" = 1st of every month.
- Use list_recurring_tasks to show all recurring definitions. Use pause/resume/skip/delete tools to manage them.
- When resuming, set createMissed=true to retroactively create tasks for missed cycles during the pause.
- When the user says "stop" or "cancel" a recurring task, use delete_recurring_task.
- When they say "pause", use pause_recurring_task. When "skip the next one", use skip_recurring_task.
```

New:

```
RECURRING TASKS — The user can set up tasks that repeat automatically:
- "cron" trigger: Use create_recurring_task with triggerType "cron" and a schedule object (tool converts to cron internally).
  - schedule.frequency: "daily", "weekly", "monthly", "weekdays", or "weekends"
  - schedule.time: "HH:MM" in 24-hour local time (e.g. "09:00")
  - schedule.days_of_week: ["mon", "wed", "fri"] — for weekly frequency only
  - schedule.day_of_month: 1–31 — for monthly frequency only
  - Examples: "every Monday at 9am" → { frequency: "weekly", time: "09:00", days_of_week: ["mon"] }
  - "weekdays at 9am" → { frequency: "weekdays", time: "09:00" }
  - "1st of each month at 10am" → { frequency: "monthly", time: "10:00", day_of_month: 1 }
- "on_complete" trigger: creates the next task only after the current one is marked done. Use triggerType "on_complete" (no schedule needed).
- Use list_recurring_tasks to show all recurring definitions. Use pause/resume/skip/delete tools to manage them.
- When resuming, set createMissed=true to retroactively create tasks for missed cycles during the pause.
- When the user says "stop" or "cancel" a recurring task, use delete_recurring_task.
- When they say "pause", use pause_recurring_task. When "skip the next one", use skip_recurring_task.
```

**D. Replace the DEFERRED PROMPTS section**

Replace the `fire_at` and cron timezone references:

Old:

```
  - One-time: provide schedule.fire_at as an ISO 8601 timestamp. Resolve natural language times to the user's timezone (${timezone}).
  - Recurring: provide schedule.cron as a 5-field cron expression. Cron times are in the user's timezone (${timezone}).
  - Common patterns: "0 9 * * 1" = every Monday 9am, "0 9 * * *" = daily 9am.
```

New:

```
  - One-time: provide schedule.fire_at as { date: "YYYY-MM-DD", time: "HH:MM" } in local time — tool converts to UTC.
  - Recurring: provide schedule.cron as a 5-field cron expression in local time (e.g. "0 9 * * 1" = every Monday 9am).
  - Common patterns: "0 9 * * 1" = every Monday 9am, "0 9 * * *" = daily 9am.
```

Also remove the trailing `(${timezone})` reference from the daily briefings line:

Old:

```
- For daily briefings, create a recurring scheduled prompt (e.g., cron "0 9 * * *" at 9am).
```

New (no change needed here — the cron stays as user-readable).

**E. Update `buildBasePrompt` signature**

Since the function only uses `timezone` for `getLocalDateString()`, remove it from the function parameter and pass `localDateStr` directly:

Old:

```typescript
const buildBasePrompt = (timezone: string): string => {
  const localDate = getLocalDateString(timezone)
  return `...${localDate} (${timezone})...`
}
```

New:

```typescript
const buildBasePrompt = (localDateStr: string): string => {
  return `...${localDateStr}...`
}
```

And update `buildSystemPrompt`:

```typescript
const buildSystemPrompt = (provider: TaskProvider, timezone: string, contextId: string): string => {
  const localDateStr = getLocalDateString(timezone)
  const base = buildBasePrompt(localDateStr)
  const addendum = provider.getPromptAddendum()
  return `${buildInstructionsBlock(contextId)}${addendum === '' ? base : `${base}\n\n${addendum}`}`
}
```

### Step 3: Typecheck

```
bun typecheck
```

### Step 4: Run all tests

```
bun test
```

### Step 5: Commit

```
git commit -m "refactor(prompt): remove timezone disclosure and conversion instructions from system prompt"
```

---

## Task 9: Full verification and cleanup

### Step 1: Run the full test suite

```
bun test
```

Expected: all tests pass.

### Step 2: Run typecheck

```
bun typecheck
```

Expected: no errors.

### Step 3: Run lint

```
bun lint
```

Fix any lint issues with:

```
bun lint:fix
```

### Step 4: Check for unused imports

```
bun knip
```

Remove any imports flagged as unused (e.g., `parseCron` in `create-recurring-task.ts` if it's no longer used after removing the cron validation step).

### Step 5: Final commit

```
git commit -m "chore: clean up unused imports after timezone refactor"
```

---

## Risk Notes

| Area                                                                         | Risk                                                                                                | Mitigation                                                                     |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `date-fns-tz` DST handling                                                   | `fromZonedTime` is battle-tested but relies on `Intl` under the hood                                | Test with `America/New_York` winter dates (UTC-5) to cover non-trivial offsets |
| `date-fns-tz` invalid timezone                                               | Returns `Invalid Date` for unknown timezone names                                                   | Explicit `isNaN` guard in `localDatetimeToUtc` falls back to UTC               |
| LLM adopts new structured schema                                             | LLM must output `{date, time}` objects instead of flat strings                                      | Clear schema descriptions + prompt examples in system prompt                   |
| `deferred-prompts/tools.test.ts` existing `fire_at` test uses raw ISO string | Test will break on schema change                                                                    | Update test in Task 7 Step 2 before implementing                               |
| `parseCron` removal from `create-recurring-task.ts`                          | May still be needed if there are other validation paths                                             | Check with `bun knip` after changes; re-add if needed                          |
| `update-task.ts` signature change breaks callers                             | `completionHook` moves to second position; `userId` becomes third                                   | TypeScript catches all call sites; only caller is `index.ts` → `makeCoreTools` |
| UTC→local output conversion missing from initial plan                        | `get-task`, `list-tasks`, `list-recurring`, `resume`, `skip` tools were not in scope originally     | Covered by Tasks 4a and 6a; verified by dedicated tests in each task           |
| `fireAt` returned as UTC string in deferred prompt list/get tools            | If `list_deferred_prompts` or `get_deferred_prompt` tools exist, their returns also need conversion | Task 7 step D explicitly covers all deferred prompt return paths               |
| Recurring task `lastRun`/`nextRun` type is `string \| null` (not undefined)  | `utcToLocal` must handle `null` passthrough cleanly                                                 | Confirmed: `utcToLocal(null, tz)` returns `null` (covered by Task 1 tests)     |

---

## Out of Scope

- Changing the DB schema for recurring tasks (timezone column stays, continues to store the user's IANA timezone at creation time)
- Migrating existing recurring task cron expressions (they remain valid — cron.ts still operates on them using the stored timezone)
- Changing the deferred-prompts cron (`schedule.cron`) field — this stays as a raw 5-field cron string (user can describe it in natural language and the LLM generates the cron; local-time interpretation is consistent with how cron.ts handles recurring tasks)
- E2E test updates (run manually after this plan is complete)
