# Deferred Prompts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task.

**Goal:** Replace the existing proactive assistance system (reminders, briefings, alerts) with a
unified "deferred prompts" abstraction — scheduled prompts and alert prompts backed by a
deterministic filter schema, all executed by the LLM with full tool access.

**Architecture:**

- Two tables (`scheduled_prompts`, `alert_prompts`) with a shared TypeScript discriminated union
- A `task_snapshots` table for `changed_to` condition evaluation
- Two independent polling loops (60s for scheduled, 5min for alerts)
- Five unified LLM tools that route to the correct table based on input
- Clean replacement of `src/proactive/` — no backward compatibility

**Current state being replaced:**

- `src/proactive/reminders.ts` — CRUD for reminders, static text delivery
- `src/proactive/briefing.ts` — Custom briefing generation, bypasses LLM
- `src/proactive/service.ts` — 5 hardcoded alert check functions
- `src/proactive/scheduler.ts` — 3 separate polling layers
- `src/proactive/tools.ts` — 8 rigid tools
- `src/db/migrations/011_proactive_alerts.ts` — old tables
- `src/db/schema.ts` — old Drizzle table definitions (lines 120-172)

**Tech Stack:** Bun, TypeScript strict mode, Drizzle ORM (bun-sqlite), Vercel AI SDK (`tool`
from `ai`, `generateText`), Zod v4, pino logger.

---

## Phase 1: Database Schema & Migration

### Task 1: Create `013_deferred_prompts` migration

**Files:**

- Create: `src/db/migrations/013_deferred_prompts.ts`

**Step 1: Write the failing test**

Create `tests/deferred-prompts/migration.test.ts`:

```typescript
import { Database } from 'bun:sqlite'
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { runMigrations } from '../../src/db/migrate.js'
import { migration001Initial } from '../../src/db/migrations/001_initial.js'
import { migration002ConversationHistory } from '../../src/db/migrations/002_conversation_history.js'
import { migration003MultiuserSupport } from '../../src/db/migrations/003_multiuser_support.js'
import { migration004KaneoWorkspace } from '../../src/db/migrations/004_kaneo_workspace.js'
import { migration005RenameConfigKeys } from '../../src/db/migrations/005_rename_config_keys.js'
import { migration006VersionAnnouncements } from '../../src/db/migrations/006_version_announcements.js'
import { migration007PlatformUserId } from '../../src/db/migrations/007_platform_user_id.js'
import { migration008GroupMembers } from '../../src/db/migrations/008_group_members.js'
import { migration009RecurringTasks } from '../../src/db/migrations/009_recurring_tasks.js'
import { migration010RecurringTaskOccurrences } from '../../src/db/migrations/010_recurring_task_occurrences.js'
import { migration011ProactiveAlerts } from '../../src/db/migrations/011_proactive_alerts.js'
import { migration012UserInstructions } from '../../src/db/migrations/012_user_instructions.js'
import { migration013DeferredPrompts } from '../../src/db/migrations/013_deferred_prompts.js'

const ALL_MIGRATIONS = [
  migration001Initial,
  migration002ConversationHistory,
  migration003MultiuserSupport,
  migration004KaneoWorkspace,
  migration005RenameConfigKeys,
  migration006VersionAnnouncements,
  migration007PlatformUserId,
  migration008GroupMembers,
  migration009RecurringTasks,
  migration010RecurringTaskOccurrences,
  migration011ProactiveAlerts,
  migration012UserInstructions,
  migration013DeferredPrompts,
]

describe('migration 013: deferred prompts', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db, [...ALL_MIGRATIONS])
  })

  afterAll(() => {
    db.close()
  })

  test('creates scheduled_prompts table', () => {
    const info = db.prepare("PRAGMA table_info('scheduled_prompts')").all()
    const columns = (info as Array<{ name: string }>).map((c) => c.name)
    expect(columns).toContain('id')
    expect(columns).toContain('user_id')
    expect(columns).toContain('prompt')
    expect(columns).toContain('fire_at')
    expect(columns).toContain('cron_expression')
    expect(columns).toContain('status')
    expect(columns).toContain('created_at')
    expect(columns).toContain('last_executed_at')
  })

  test('creates alert_prompts table', () => {
    const info = db.prepare("PRAGMA table_info('alert_prompts')").all()
    const columns = (info as Array<{ name: string }>).map((c) => c.name)
    expect(columns).toContain('id')
    expect(columns).toContain('user_id')
    expect(columns).toContain('prompt')
    expect(columns).toContain('condition')
    expect(columns).toContain('status')
    expect(columns).toContain('created_at')
    expect(columns).toContain('last_triggered_at')
    expect(columns).toContain('cooldown_minutes')
  })

  test('creates task_snapshots table', () => {
    const info = db.prepare("PRAGMA table_info('task_snapshots')").all()
    const columns = (info as Array<{ name: string }>).map((c) => c.name)
    expect(columns).toContain('user_id')
    expect(columns).toContain('task_id')
    expect(columns).toContain('field')
    expect(columns).toContain('value')
    expect(columns).toContain('captured_at')
  })

  test('drops old proactive tables', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
    const names = tables.map((t) => t.name)
    expect(names).not.toContain('reminders')
    expect(names).not.toContain('user_briefing_state')
    expect(names).not.toContain('alert_state')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/deferred-prompts/migration.test.ts`
Expected: FAIL — module `013_deferred_prompts.js` not found

**Step 3: Write the migration**

```typescript
// src/db/migrations/013_deferred_prompts.ts
import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration013DeferredPrompts: Migration = {
  id: '013_deferred_prompts',
  up(db: Database): void {
    db.run(`
      CREATE TABLE scheduled_prompts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        fire_at TEXT NOT NULL,
        cron_expression TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT DEFAULT (datetime('now')) NOT NULL,
        last_executed_at TEXT
      )
    `)
    db.run('CREATE INDEX idx_scheduled_prompts_user ON scheduled_prompts(user_id)')
    db.run('CREATE INDEX idx_scheduled_prompts_status_fire ON scheduled_prompts(status, fire_at)')

    db.run(`
      CREATE TABLE alert_prompts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        condition TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT DEFAULT (datetime('now')) NOT NULL,
        last_triggered_at TEXT,
        cooldown_minutes INTEGER NOT NULL DEFAULT 60
      )
    `)
    db.run('CREATE INDEX idx_alert_prompts_user ON alert_prompts(user_id)')
    db.run('CREATE INDEX idx_alert_prompts_status ON alert_prompts(status)')

    db.run(`
      CREATE TABLE task_snapshots (
        user_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        field TEXT NOT NULL,
        value TEXT NOT NULL,
        captured_at TEXT DEFAULT (datetime('now')) NOT NULL,
        PRIMARY KEY (user_id, task_id, field)
      )
    `)
    db.run('CREATE INDEX idx_task_snapshots_user ON task_snapshots(user_id)')

    // Drop old proactive tables
    db.run('DROP TABLE IF EXISTS reminders')
    db.run('DROP TABLE IF EXISTS user_briefing_state')
    db.run('DROP TABLE IF EXISTS alert_state')
  },
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/deferred-prompts/migration.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/db/migrations/013_deferred_prompts.ts tests/deferred-prompts/migration.test.ts
git commit -m "feat: add migration 013 for deferred prompts tables"
```

---

### Task 2: Update Drizzle schema and test helpers

**Files:**

- Modify: `src/db/schema.ts` — replace old table definitions (lines 120-172) with new ones
- Modify: `tests/utils/test-helpers.ts` — add migration 013 to `ALL_MIGRATIONS` (line 24, 43)

**Step 1: Update `src/db/schema.ts`**

Remove lines 120-172 (the `reminders`, `userBriefingState`, `alertState` tables and their types).
Add new table definitions:

```typescript
export const scheduledPrompts = sqliteTable(
  'scheduled_prompts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    prompt: text('prompt').notNull(),
    fireAt: text('fire_at').notNull(),
    cronExpression: text('cron_expression'),
    status: text('status').notNull().default('active'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    lastExecutedAt: text('last_executed_at'),
  },
  (table) => [
    index('idx_scheduled_prompts_user').on(table.userId),
    index('idx_scheduled_prompts_status_fire').on(table.status, table.fireAt),
  ],
)

export const alertPrompts = sqliteTable(
  'alert_prompts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    prompt: text('prompt').notNull(),
    condition: text('condition').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    lastTriggeredAt: text('last_triggered_at'),
    cooldownMinutes: integer('cooldown_minutes').notNull().default(60),
  },
  (table) => [index('idx_alert_prompts_user').on(table.userId), index('idx_alert_prompts_status').on(table.status)],
)

export const taskSnapshots = sqliteTable(
  'task_snapshots',
  {
    userId: text('user_id').notNull(),
    taskId: text('task_id').notNull(),
    field: text('field').notNull(),
    value: text('value').notNull(),
    capturedAt: text('captured_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.taskId, table.field] }),
    index('idx_task_snapshots_user').on(table.userId),
  ],
)

export type ScheduledPromptRow = typeof scheduledPrompts.$inferSelect
export type AlertPromptRow = typeof alertPrompts.$inferSelect
export type TaskSnapshotRow = typeof taskSnapshots.$inferSelect
```

Remove old type exports: `Reminder`, `UserBriefingState`, `AlertStateRow`.

**Step 2: Update `tests/utils/test-helpers.ts`**

Add import for migration 013:

```typescript
import { migration013DeferredPrompts } from '../../src/db/migrations/013_deferred_prompts.js'
```

Add to `ALL_MIGRATIONS` array:

```typescript
migration013DeferredPrompts,
```

**Step 3: Run existing tests to verify nothing broke**

Run: `bun test`
Expected: PASS (some proactive tests may fail — that's expected since schema changed; they'll be removed in Phase 5)

**Step 4: Commit**

```bash
git add src/db/schema.ts tests/utils/test-helpers.ts
git commit -m "feat: update Drizzle schema with deferred prompt tables"
```

---

## Phase 2: Core Types & Validation

### Task 3: Create types and Zod schemas for deferred prompts

**Files:**

- Create: `src/deferred-prompts/types.ts`

**Step 1: Write the failing test**

Create `tests/deferred-prompts/types.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'

import {
  alertConditionSchema,
  type AlertCondition,
  type ScheduledPrompt,
  type AlertPrompt,
  type DeferredPrompt,
} from '../../src/deferred-prompts/types.js'

describe('alertConditionSchema', () => {
  test('validates a leaf eq condition', () => {
    const condition: AlertCondition = { field: 'task.status', op: 'eq', value: 'done' }
    const result = alertConditionSchema.safeParse(condition)
    expect(result.success).toBe(true)
  })

  test('validates overdue condition (no value)', () => {
    const condition: AlertCondition = { field: 'task.dueDate', op: 'overdue' }
    const result = alertConditionSchema.safeParse(condition)
    expect(result.success).toBe(true)
  })

  test('validates stale_days condition (numeric value)', () => {
    const condition: AlertCondition = { field: 'task.updatedAt', op: 'stale_days', value: 7 }
    const result = alertConditionSchema.safeParse(condition)
    expect(result.success).toBe(true)
  })

  test('validates and combinator', () => {
    const condition: AlertCondition = {
      and: [
        { field: 'task.project', op: 'eq', value: 'Alpha' },
        { field: 'task.status', op: 'changed_to', value: 'done' },
      ],
    }
    const result = alertConditionSchema.safeParse(condition)
    expect(result.success).toBe(true)
  })

  test('validates or combinator', () => {
    const condition: AlertCondition = {
      or: [
        { field: 'task.priority', op: 'eq', value: 'urgent' },
        { field: 'task.dueDate', op: 'overdue' },
      ],
    }
    const result = alertConditionSchema.safeParse(condition)
    expect(result.success).toBe(true)
  })

  test('validates nested combinators', () => {
    const condition: AlertCondition = {
      and: [
        { field: 'task.project', op: 'eq', value: 'Alpha' },
        {
          or: [
            { field: 'task.status', op: 'changed_to', value: 'done' },
            { field: 'task.dueDate', op: 'overdue' },
          ],
        },
      ],
    }
    const result = alertConditionSchema.safeParse(condition)
    expect(result.success).toBe(true)
  })

  test('rejects invalid field', () => {
    const condition = { field: 'task.invalid', op: 'eq', value: 'x' }
    const result = alertConditionSchema.safeParse(condition)
    expect(result.success).toBe(false)
  })

  test('rejects invalid operator for field', () => {
    const condition = { field: 'task.status', op: 'gt', value: 'x' }
    const result = alertConditionSchema.safeParse(condition)
    expect(result.success).toBe(false)
  })

  test('rejects empty and array', () => {
    const condition = { and: [] }
    const result = alertConditionSchema.safeParse(condition)
    expect(result.success).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/deferred-prompts/types.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// src/deferred-prompts/types.ts
import { z } from 'zod'

// ============================================================================
// ALERT CONDITION SCHEMA
// ============================================================================

const CONDITION_FIELDS = [
  'task.status',
  'task.priority',
  'task.assignee',
  'task.dueDate',
  'task.updatedAt',
  'task.project',
  'task.labels',
] as const

type ConditionField = (typeof CONDITION_FIELDS)[number]

/** Valid operators per field */
const FIELD_OPERATORS: Record<ConditionField, readonly string[]> = {
  'task.status': ['eq', 'neq', 'changed_to'],
  'task.priority': ['eq', 'neq', 'changed_to'],
  'task.assignee': ['eq', 'neq', 'changed_to'],
  'task.dueDate': ['eq', 'lt', 'gt', 'overdue'],
  'task.updatedAt': ['lt', 'gt', 'stale_days'],
  'task.project': ['eq', 'neq'],
  'task.labels': ['contains', 'not_contains'],
}

export { CONDITION_FIELDS, FIELD_OPERATORS }

const leafConditionSchema = z
  .object({
    field: z.enum(CONDITION_FIELDS),
    op: z.string(),
    value: z.union([z.string(), z.number()]).optional(),
  })
  .refine(
    (data) => {
      const validOps = FIELD_OPERATORS[data.field]
      return validOps.includes(data.op)
    },
    { message: 'Invalid operator for the specified field' },
  )

export type LeafCondition = z.infer<typeof leafConditionSchema>

// Recursive schema for combinators
export type AlertCondition = LeafCondition | { and: AlertCondition[] } | { or: AlertCondition[] }

export const alertConditionSchema: z.ZodType<AlertCondition> = z.lazy(() =>
  z.union([
    leafConditionSchema,
    z.object({ and: z.array(alertConditionSchema).min(1) }),
    z.object({ or: z.array(alertConditionSchema).min(1) }),
  ]),
)

// ============================================================================
// DEFERRED PROMPT TYPES
// ============================================================================

export type ScheduledPrompt = {
  type: 'scheduled'
  id: string
  userId: string
  prompt: string
  fireAt: string
  cronExpression: string | null
  status: 'active' | 'completed' | 'cancelled'
  createdAt: string
  lastExecutedAt: string | null
}

export type AlertPrompt = {
  type: 'alert'
  id: string
  userId: string
  prompt: string
  condition: AlertCondition
  status: 'active' | 'cancelled'
  createdAt: string
  lastTriggeredAt: string | null
  cooldownMinutes: number
}

export type DeferredPrompt = ScheduledPrompt | AlertPrompt
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/deferred-prompts/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/deferred-prompts/types.ts tests/deferred-prompts/types.test.ts
git commit -m "feat: add deferred prompt types and alert condition Zod schema"
```

---

## Phase 3: CRUD Operations

### Task 4: Implement scheduled prompt CRUD

**Files:**

- Create: `src/deferred-prompts/scheduled.ts`
- Create: `tests/deferred-prompts/scheduled.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/deferred-prompts/scheduled.test.ts
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { mockLogger, mockDrizzle, setupTestDb } from '../utils/test-helpers.js'

mockLogger()
mockDrizzle()

import {
  createScheduledPrompt,
  listScheduledPrompts,
  getScheduledPrompt,
  updateScheduledPrompt,
  cancelScheduledPrompt,
  getScheduledPromptsDue,
  advanceScheduledPrompt,
} from '../../src/deferred-prompts/scheduled.js'

describe('scheduled prompt CRUD', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  afterAll(() => {
    const { mock } = require('bun:test')
    mock.restore()
  })

  test('creates a one-shot prompt', () => {
    const result = createScheduledPrompt('user-1', 'Archive stale tasks', {
      fireAt: '2026-04-01T09:00:00Z',
    })
    expect(result.id).toBeDefined()
    expect(result.prompt).toBe('Archive stale tasks')
    expect(result.fireAt).toBe('2026-04-01T09:00:00.000Z')
    expect(result.cronExpression).toBeNull()
    expect(result.status).toBe('active')
  })

  test('creates a recurring prompt', () => {
    const result = createScheduledPrompt('user-1', 'Weekly summary', {
      fireAt: '2026-04-01T09:00:00Z',
      cronExpression: '0 9 * * 1',
    })
    expect(result.cronExpression).toBe('0 9 * * 1')
  })

  test('lists prompts for user', () => {
    createScheduledPrompt('user-1', 'Prompt 1', { fireAt: '2026-04-01T09:00:00Z' })
    createScheduledPrompt('user-1', 'Prompt 2', { fireAt: '2026-04-02T09:00:00Z' })
    createScheduledPrompt('user-2', 'Other user', { fireAt: '2026-04-01T09:00:00Z' })

    const list = listScheduledPrompts('user-1')
    expect(list).toHaveLength(2)
  })

  test('lists prompts filtered by status', () => {
    createScheduledPrompt('user-1', 'Active', { fireAt: '2026-04-01T09:00:00Z' })
    const toCancel = createScheduledPrompt('user-1', 'Cancelled', { fireAt: '2026-04-02T09:00:00Z' })
    cancelScheduledPrompt(toCancel.id, 'user-1')

    const active = listScheduledPrompts('user-1', 'active')
    expect(active).toHaveLength(1)
    expect(active[0]!.prompt).toBe('Active')
  })

  test('gets a prompt by id', () => {
    const created = createScheduledPrompt('user-1', 'Test', { fireAt: '2026-04-01T09:00:00Z' })
    const fetched = getScheduledPrompt(created.id, 'user-1')
    expect(fetched).not.toBeNull()
    expect(fetched!.prompt).toBe('Test')
  })

  test('returns null for wrong user', () => {
    const created = createScheduledPrompt('user-1', 'Test', { fireAt: '2026-04-01T09:00:00Z' })
    const fetched = getScheduledPrompt(created.id, 'user-2')
    expect(fetched).toBeNull()
  })

  test('updates prompt text', () => {
    const created = createScheduledPrompt('user-1', 'Old text', { fireAt: '2026-04-01T09:00:00Z' })
    updateScheduledPrompt(created.id, 'user-1', { prompt: 'New text' })
    const fetched = getScheduledPrompt(created.id, 'user-1')
    expect(fetched!.prompt).toBe('New text')
  })

  test('cancels a prompt', () => {
    const created = createScheduledPrompt('user-1', 'Test', { fireAt: '2026-04-01T09:00:00Z' })
    cancelScheduledPrompt(created.id, 'user-1')
    const fetched = getScheduledPrompt(created.id, 'user-1')
    expect(fetched!.status).toBe('cancelled')
  })

  test('gets due prompts', () => {
    const pastDate = new Date(Date.now() - 60_000).toISOString()
    const futureDate = new Date(Date.now() + 3_600_000).toISOString()
    createScheduledPrompt('user-1', 'Due', { fireAt: pastDate })
    createScheduledPrompt('user-1', 'Not due', { fireAt: futureDate })

    const due = getScheduledPromptsDue()
    expect(due).toHaveLength(1)
    expect(due[0]!.prompt).toBe('Due')
  })

  test('advances a recurring prompt', () => {
    const created = createScheduledPrompt('user-1', 'Recurring', {
      fireAt: '2026-03-24T09:00:00Z',
      cronExpression: '0 9 * * 1',
    })
    advanceScheduledPrompt(created.id, '2026-03-31T09:00:00Z', '2026-03-24T09:00:00Z')
    const fetched = getScheduledPrompt(created.id, 'user-1')
    expect(fetched!.fireAt).toBe('2026-03-31T09:00:00Z')
    expect(fetched!.lastExecutedAt).toBe('2026-03-24T09:00:00Z')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/deferred-prompts/scheduled.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// src/deferred-prompts/scheduled.ts
import { and, eq, lte } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { scheduledPrompts } from '../db/schema.js'
import { logger } from '../logger.js'
import type { ScheduledPrompt } from './types.js'

const log = logger.child({ scope: 'deferred:scheduled' })

const generateId = (): string => crypto.randomUUID()

function toScheduledPrompt(row: typeof scheduledPrompts.$inferSelect): ScheduledPrompt {
  return {
    type: 'scheduled',
    id: row.id,
    userId: row.userId,
    prompt: row.prompt,
    fireAt: row.fireAt,
    cronExpression: row.cronExpression,
    status: row.status as ScheduledPrompt['status'],
    createdAt: row.createdAt,
    lastExecutedAt: row.lastExecutedAt,
  }
}

export function createScheduledPrompt(
  userId: string,
  prompt: string,
  schedule: { fireAt: string; cronExpression?: string },
): ScheduledPrompt {
  log.debug(
    { userId, fireAt: schedule.fireAt, hasCron: schedule.cronExpression !== undefined },
    'Creating scheduled prompt',
  )
  const db = getDrizzleDb()
  const id = generateId()
  const normalizedFireAt = new Date(schedule.fireAt).toISOString()

  db.insert(scheduledPrompts)
    .values({
      id,
      userId,
      prompt,
      fireAt: normalizedFireAt,
      cronExpression: schedule.cronExpression ?? null,
    })
    .run()

  log.info({ id, userId }, 'Scheduled prompt created')
  return toScheduledPrompt(db.select().from(scheduledPrompts).where(eq(scheduledPrompts.id, id)).get()!)
}

export function listScheduledPrompts(userId: string, status?: string): ScheduledPrompt[] {
  log.debug({ userId, status }, 'Listing scheduled prompts')
  const db = getDrizzleDb()
  const conditions = [eq(scheduledPrompts.userId, userId)]
  if (status !== undefined) conditions.push(eq(scheduledPrompts.status, status))
  return db
    .select()
    .from(scheduledPrompts)
    .where(and(...conditions))
    .all()
    .map(toScheduledPrompt)
}

export function getScheduledPrompt(id: string, userId: string): ScheduledPrompt | null {
  log.debug({ id, userId }, 'Getting scheduled prompt')
  const db = getDrizzleDb()
  const row = db
    .select()
    .from(scheduledPrompts)
    .where(and(eq(scheduledPrompts.id, id), eq(scheduledPrompts.userId, userId)))
    .get()
  return row !== undefined ? toScheduledPrompt(row) : null
}

export function updateScheduledPrompt(
  id: string,
  userId: string,
  updates: { prompt?: string; fireAt?: string; cronExpression?: string | null },
): void {
  log.debug({ id, userId }, 'Updating scheduled prompt')
  const db = getDrizzleDb()
  const values: Record<string, string | null> = {}
  if (updates.prompt !== undefined) values['prompt'] = updates.prompt
  if (updates.fireAt !== undefined) values['fireAt'] = updates.fireAt
  if (updates.cronExpression !== undefined) values['cronExpression'] = updates.cronExpression
  db.update(scheduledPrompts)
    .set(values)
    .where(and(eq(scheduledPrompts.id, id), eq(scheduledPrompts.userId, userId)))
    .run()
  log.info({ id, userId }, 'Scheduled prompt updated')
}

export function cancelScheduledPrompt(id: string, userId: string): void {
  log.debug({ id, userId }, 'Cancelling scheduled prompt')
  const db = getDrizzleDb()
  db.update(scheduledPrompts)
    .set({ status: 'cancelled' })
    .where(and(eq(scheduledPrompts.id, id), eq(scheduledPrompts.userId, userId)))
    .run()
  log.info({ id, userId }, 'Scheduled prompt cancelled')
}

export function getScheduledPromptsDue(limit = 50): ScheduledPrompt[] {
  log.debug('Fetching due scheduled prompts')
  const db = getDrizzleDb()
  const now = new Date().toISOString()
  return db
    .select()
    .from(scheduledPrompts)
    .where(and(eq(scheduledPrompts.status, 'active'), lte(scheduledPrompts.fireAt, now)))
    .limit(limit)
    .all()
    .map(toScheduledPrompt)
}

export function advanceScheduledPrompt(id: string, nextFireAt: string, lastExecutedAt: string): void {
  log.debug({ id, nextFireAt }, 'Advancing scheduled prompt')
  const db = getDrizzleDb()
  db.update(scheduledPrompts).set({ fireAt: nextFireAt, lastExecutedAt }).where(eq(scheduledPrompts.id, id)).run()
}

export function completeScheduledPrompt(id: string, lastExecutedAt: string): void {
  log.debug({ id }, 'Completing one-shot scheduled prompt')
  const db = getDrizzleDb()
  db.update(scheduledPrompts).set({ status: 'completed', lastExecutedAt }).where(eq(scheduledPrompts.id, id)).run()
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/deferred-prompts/scheduled.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/deferred-prompts/scheduled.ts tests/deferred-prompts/scheduled.test.ts
git commit -m "feat: implement scheduled prompt CRUD operations"
```

---

### Task 5: Implement alert prompt CRUD and condition evaluation

**Files:**

- Create: `src/deferred-prompts/alerts.ts`
- Create: `tests/deferred-prompts/alerts.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/deferred-prompts/alerts.test.ts
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { mockLogger, mockDrizzle, setupTestDb } from '../utils/test-helpers.js'

mockLogger()
mockDrizzle()

import {
  createAlertPrompt,
  listAlertPrompts,
  getAlertPrompt,
  updateAlertPrompt,
  cancelAlertPrompt,
  getEligibleAlertPrompts,
  updateAlertTriggerTime,
  evaluateCondition,
  describeCondition,
} from '../../src/deferred-prompts/alerts.js'
import type { AlertCondition } from '../../src/deferred-prompts/types.js'
import type { Task } from '../../src/providers/types.js'

describe('alert prompt CRUD', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  afterAll(() => {
    const { mock } = require('bun:test')
    mock.restore()
  })

  test('creates an alert prompt', () => {
    const condition: AlertCondition = { field: 'task.status', op: 'changed_to', value: 'done' }
    const result = createAlertPrompt('user-1', 'Notify on completion', condition, 30)
    expect(result.id).toBeDefined()
    expect(result.prompt).toBe('Notify on completion')
    expect(result.condition).toEqual(condition)
    expect(result.cooldownMinutes).toBe(30)
    expect(result.status).toBe('active')
  })

  test('lists alert prompts for user', () => {
    const condition: AlertCondition = { field: 'task.status', op: 'eq', value: 'done' }
    createAlertPrompt('user-1', 'Alert 1', condition)
    createAlertPrompt('user-1', 'Alert 2', condition)
    createAlertPrompt('user-2', 'Other', condition)

    const list = listAlertPrompts('user-1')
    expect(list).toHaveLength(2)
  })

  test('gets eligible alerts (respects cooldown)', () => {
    const condition: AlertCondition = { field: 'task.status', op: 'eq', value: 'done' }
    createAlertPrompt('user-1', 'Eligible', condition, 60)

    const recentlyTriggered = createAlertPrompt('user-1', 'Too recent', condition, 60)
    updateAlertTriggerTime(recentlyTriggered.id, new Date().toISOString())

    const eligible = getEligibleAlertPrompts()
    expect(eligible).toHaveLength(1)
    expect(eligible[0]!.prompt).toBe('Eligible')
  })

  test('cancels an alert prompt', () => {
    const condition: AlertCondition = { field: 'task.status', op: 'eq', value: 'done' }
    const created = createAlertPrompt('user-1', 'Test', condition)
    cancelAlertPrompt(created.id, 'user-1')
    const fetched = getAlertPrompt(created.id, 'user-1')
    expect(fetched!.status).toBe('cancelled')
  })
})

describe('evaluateCondition', () => {
  const task: Task = {
    id: 'task-1',
    title: 'Test task',
    status: 'done',
    priority: 'high',
    assignee: 'alice',
    dueDate: '2026-03-20T00:00:00Z',
    projectId: 'proj-1',
    url: 'https://example.com/task-1',
    labels: [{ id: 'l1', name: 'bug', color: '#ff0000' }],
  }

  test('eq operator matches', () => {
    const condition: AlertCondition = { field: 'task.status', op: 'eq', value: 'done' }
    expect(evaluateCondition(condition, task, new Map())).toBe(true)
  })

  test('neq operator matches', () => {
    const condition: AlertCondition = { field: 'task.status', op: 'neq', value: 'todo' }
    expect(evaluateCondition(condition, task, new Map())).toBe(true)
  })

  test('changed_to matches when snapshot differs', () => {
    const condition: AlertCondition = { field: 'task.status', op: 'changed_to', value: 'done' }
    const snapshots = new Map([['task-1:status', 'in_progress']])
    expect(evaluateCondition(condition, task, snapshots)).toBe(true)
  })

  test('changed_to does not match when snapshot same', () => {
    const condition: AlertCondition = { field: 'task.status', op: 'changed_to', value: 'done' }
    const snapshots = new Map([['task-1:status', 'done']])
    expect(evaluateCondition(condition, task, snapshots)).toBe(false)
  })

  test('changed_to does not match when no snapshot (first time seen)', () => {
    const condition: AlertCondition = { field: 'task.status', op: 'changed_to', value: 'done' }
    expect(evaluateCondition(condition, task, new Map())).toBe(false)
  })

  test('overdue matches when dueDate is past', () => {
    const condition: AlertCondition = { field: 'task.dueDate', op: 'overdue' }
    expect(evaluateCondition(condition, task, new Map())).toBe(true)
  })

  test('overdue does not match when dueDate is future', () => {
    const futureTask = { ...task, dueDate: '2099-12-31T00:00:00Z' }
    const condition: AlertCondition = { field: 'task.dueDate', op: 'overdue' }
    expect(evaluateCondition(condition, futureTask, new Map())).toBe(false)
  })

  test('stale_days matches when updatedAt is old enough', () => {
    const staleDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    const staleTask = { ...task, createdAt: staleDate }
    const condition: AlertCondition = { field: 'task.updatedAt', op: 'stale_days', value: 7 }
    // updatedAt not set on Task type — uses createdAt as fallback
    expect(evaluateCondition(condition, staleTask, new Map())).toBe(true)
  })

  test('contains matches label', () => {
    const condition: AlertCondition = { field: 'task.labels', op: 'contains', value: 'bug' }
    expect(evaluateCondition(condition, task, new Map())).toBe(true)
  })

  test('not_contains matches missing label', () => {
    const condition: AlertCondition = { field: 'task.labels', op: 'not_contains', value: 'feature' }
    expect(evaluateCondition(condition, task, new Map())).toBe(true)
  })

  test('and combinator: all must match', () => {
    const condition: AlertCondition = {
      and: [
        { field: 'task.status', op: 'eq', value: 'done' },
        { field: 'task.priority', op: 'eq', value: 'high' },
      ],
    }
    expect(evaluateCondition(condition, task, new Map())).toBe(true)
  })

  test('and combinator: one fails', () => {
    const condition: AlertCondition = {
      and: [
        { field: 'task.status', op: 'eq', value: 'done' },
        { field: 'task.priority', op: 'eq', value: 'low' },
      ],
    }
    expect(evaluateCondition(condition, task, new Map())).toBe(false)
  })

  test('or combinator: one matches', () => {
    const condition: AlertCondition = {
      or: [
        { field: 'task.status', op: 'eq', value: 'todo' },
        { field: 'task.priority', op: 'eq', value: 'high' },
      ],
    }
    expect(evaluateCondition(condition, task, new Map())).toBe(true)
  })
})

describe('describeCondition', () => {
  test('describes a leaf condition', () => {
    const condition: AlertCondition = { field: 'task.status', op: 'changed_to', value: 'done' }
    const desc = describeCondition(condition)
    expect(desc).toContain('task.status')
    expect(desc).toContain('changed_to')
    expect(desc).toContain('done')
  })

  test('describes an and combinator', () => {
    const condition: AlertCondition = {
      and: [
        { field: 'task.project', op: 'eq', value: 'Alpha' },
        { field: 'task.status', op: 'eq', value: 'done' },
      ],
    }
    const desc = describeCondition(condition)
    expect(desc).toContain('AND')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/deferred-prompts/alerts.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `src/deferred-prompts/alerts.ts` implementing:

- `createAlertPrompt`, `listAlertPrompts`, `getAlertPrompt`, `updateAlertPrompt`,
  `cancelAlertPrompt`, `updateAlertTriggerTime`, `getEligibleAlertPrompts`
- `evaluateCondition(condition, task, snapshots)` — recursive evaluator
- `describeCondition(condition)` — human-readable description

The CRUD follows the same pattern as `scheduled.ts` (Drizzle ORM on `alertPrompts` table).
The condition is stored as JSON string, parsed back with `alertConditionSchema` on read.

Key implementation detail for `evaluateCondition`:

```typescript
function getTaskFieldValue(task: Task, field: string): string | string[] | null {
  switch (field) {
    case 'task.status':
      return task.status ?? null
    case 'task.priority':
      return task.priority ?? null
    case 'task.assignee':
      return task.assignee ?? null
    case 'task.dueDate':
      return task.dueDate ?? null
    case 'task.updatedAt':
      return task.createdAt ?? null // Task type uses createdAt
    case 'task.project':
      return task.projectId ?? null
    case 'task.labels':
      return (task.labels ?? []).map((l) => l.name)
    default:
      return null
  }
}

export function evaluateCondition(condition: AlertCondition, task: Task, snapshots: Map<string, string>): boolean {
  if ('and' in condition) return condition.and.every((c) => evaluateCondition(c, task, snapshots))
  if ('or' in condition) return condition.or.some((c) => evaluateCondition(c, task, snapshots))

  // Leaf condition
  const fieldValue = getTaskFieldValue(task, condition.field)

  switch (condition.op) {
    case 'eq':
      return fieldValue === condition.value
    case 'neq':
      return fieldValue !== condition.value
    case 'changed_to': {
      const snapshotKey = `${task.id}:${condition.field.replace('task.', '')}`
      const prev = snapshots.get(snapshotKey)
      if (prev === undefined) return false // first time seen, no change
      return prev !== String(condition.value) && fieldValue === condition.value
    }
    case 'overdue':
      return fieldValue !== null && new Date(fieldValue as string) < new Date()
    case 'stale_days': {
      if (fieldValue === null || condition.value === undefined) return false
      const daysDiff = (Date.now() - new Date(fieldValue as string).getTime()) / (24 * 60 * 60 * 1000)
      return daysDiff > Number(condition.value)
    }
    case 'gt':
      return fieldValue !== null && new Date(fieldValue as string) > new Date(String(condition.value))
    case 'lt':
      return fieldValue !== null && new Date(fieldValue as string) < new Date(String(condition.value))
    case 'contains':
      return Array.isArray(fieldValue) && fieldValue.includes(String(condition.value))
    case 'not_contains':
      return Array.isArray(fieldValue) && !fieldValue.includes(String(condition.value))
    default:
      return false
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/deferred-prompts/alerts.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/deferred-prompts/alerts.ts tests/deferred-prompts/alerts.test.ts
git commit -m "feat: implement alert prompt CRUD and condition evaluation"
```

---

### Task 6: Implement task snapshot management

**Files:**

- Create: `src/deferred-prompts/snapshots.ts`
- Create: `tests/deferred-prompts/snapshots.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/deferred-prompts/snapshots.test.ts
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { mockLogger, mockDrizzle, setupTestDb } from '../utils/test-helpers.js'

mockLogger()
mockDrizzle()

import { captureSnapshot, getSnapshotsForUser, updateSnapshots } from '../../src/deferred-prompts/snapshots.js'
import type { Task } from '../../src/providers/types.js'

describe('task snapshots', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  afterAll(() => {
    const { mock } = require('bun:test')
    mock.restore()
  })

  test('captures a snapshot for a task', () => {
    const task: Task = {
      id: 'task-1',
      title: 'Test',
      status: 'todo',
      priority: 'high',
      url: 'https://example.com',
    }
    captureSnapshot('user-1', task)

    const snapshots = getSnapshotsForUser('user-1')
    expect(snapshots.get('task-1:status')).toBe('todo')
    expect(snapshots.get('task-1:priority')).toBe('high')
  })

  test('updates snapshots in bulk', () => {
    const tasks: Task[] = [
      { id: 'task-1', title: 'A', status: 'todo', url: 'https://example.com' },
      { id: 'task-2', title: 'B', status: 'done', priority: 'low', url: 'https://example.com' },
    ]
    updateSnapshots('user-1', tasks)

    const snapshots = getSnapshotsForUser('user-1')
    expect(snapshots.get('task-1:status')).toBe('todo')
    expect(snapshots.get('task-2:status')).toBe('done')
    expect(snapshots.get('task-2:priority')).toBe('low')
  })

  test('overwrites existing snapshot values', () => {
    const task: Task = { id: 'task-1', title: 'A', status: 'todo', url: 'https://example.com' }
    captureSnapshot('user-1', task)
    const updated: Task = { id: 'task-1', title: 'A', status: 'done', url: 'https://example.com' }
    captureSnapshot('user-1', updated)

    const snapshots = getSnapshotsForUser('user-1')
    expect(snapshots.get('task-1:status')).toBe('done')
  })

  test('isolates snapshots between users', () => {
    const task: Task = { id: 'task-1', title: 'A', status: 'todo', url: 'https://example.com' }
    captureSnapshot('user-1', task)
    captureSnapshot('user-2', { ...task, status: 'done' })

    expect(getSnapshotsForUser('user-1').get('task-1:status')).toBe('todo')
    expect(getSnapshotsForUser('user-2').get('task-1:status')).toBe('done')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/deferred-prompts/snapshots.test.ts`
Expected: FAIL

**Step 3: Write the implementation**

```typescript
// src/deferred-prompts/snapshots.ts
import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { taskSnapshots } from '../db/schema.js'
import { logger } from '../logger.js'
import type { Task } from '../providers/types.js'

const log = logger.child({ scope: 'deferred:snapshots' })

/** Fields to snapshot from a Task. */
const SNAPSHOT_FIELDS: Array<{ field: string; extract: (task: Task) => string | null }> = [
  { field: 'status', extract: (t) => t.status ?? null },
  { field: 'priority', extract: (t) => t.priority ?? null },
  { field: 'assignee', extract: (t) => t.assignee ?? null },
  { field: 'dueDate', extract: (t) => t.dueDate ?? null },
  { field: 'project', extract: (t) => t.projectId ?? null },
]

export function captureSnapshot(userId: string, task: Task): void {
  log.debug({ userId, taskId: task.id }, 'Capturing snapshot')
  const db = getDrizzleDb()
  const now = new Date().toISOString()

  for (const { field, extract } of SNAPSHOT_FIELDS) {
    const value = extract(task)
    if (value === null) continue
    db.insert(taskSnapshots)
      .values({ userId, taskId: task.id, field, value, capturedAt: now })
      .onConflictDoUpdate({
        target: [taskSnapshots.userId, taskSnapshots.taskId, taskSnapshots.field],
        set: { value, capturedAt: now },
      })
      .run()
  }
}

export function getSnapshotsForUser(userId: string): Map<string, string> {
  log.debug({ userId }, 'Loading snapshots')
  const db = getDrizzleDb()
  const rows = db.select().from(taskSnapshots).where(eq(taskSnapshots.userId, userId)).all()
  const map = new Map<string, string>()
  for (const row of rows) {
    map.set(`${row.taskId}:${row.field}`, row.value)
  }
  return map
}

export function updateSnapshots(userId: string, tasks: Task[]): void {
  log.debug({ userId, taskCount: tasks.length }, 'Updating snapshots in bulk')
  for (const task of tasks) {
    captureSnapshot(userId, task)
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/deferred-prompts/snapshots.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/deferred-prompts/snapshots.ts tests/deferred-prompts/snapshots.test.ts
git commit -m "feat: implement task snapshot management for change detection"
```

---

## Phase 4: LLM Tools

### Task 7: Implement the 5 unified deferred prompt tools

**Files:**

- Create: `src/deferred-prompts/tools.ts`
- Create: `tests/deferred-prompts/tools.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/deferred-prompts/tools.test.ts
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { mockLogger, mockDrizzle, setupTestDb } from '../utils/test-helpers.js'

mockLogger()
mockDrizzle()

import { makeDeferredPromptTools } from '../../src/deferred-prompts/tools.js'

describe('deferred prompt tools', () => {
  let tools: ReturnType<typeof makeDeferredPromptTools>

  beforeEach(async () => {
    await setupTestDb()
    tools = makeDeferredPromptTools('user-1')
  })

  afterAll(() => {
    const { mock } = require('bun:test')
    mock.restore()
  })

  test('exposes all 5 tools', () => {
    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining([
        'create_deferred_prompt',
        'list_deferred_prompts',
        'get_deferred_prompt',
        'update_deferred_prompt',
        'cancel_deferred_prompt',
      ]),
    )
    expect(Object.keys(tools)).toHaveLength(5)
  })

  test('create_deferred_prompt creates a scheduled prompt', async () => {
    const result = await tools['create_deferred_prompt']!.execute(
      { prompt: 'Archive stale tasks', schedule: { fire_at: '2026-04-01T09:00:00Z' } },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    )
    expect(result).toHaveProperty('status', 'created')
    expect(result).toHaveProperty('type', 'scheduled')
    expect(result).toHaveProperty('id')
  })

  test('create_deferred_prompt creates an alert prompt', async () => {
    const result = await tools['create_deferred_prompt']!.execute(
      {
        prompt: 'Notify on completion',
        condition: { field: 'task.status', op: 'changed_to', value: 'done' },
        cooldown_minutes: 30,
      },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    )
    expect(result).toHaveProperty('status', 'created')
    expect(result).toHaveProperty('type', 'alert')
  })

  test('create_deferred_prompt rejects both schedule and condition', async () => {
    const result = await tools['create_deferred_prompt']!.execute(
      {
        prompt: 'Bad',
        schedule: { fire_at: '2026-04-01T09:00:00Z' },
        condition: { field: 'task.status', op: 'eq', value: 'done' },
      },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    )
    expect(result).toHaveProperty('error')
  })

  test('create_deferred_prompt rejects neither schedule nor condition', async () => {
    const result = await tools['create_deferred_prompt']!.execute(
      { prompt: 'Bad' },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    )
    expect(result).toHaveProperty('error')
  })

  test('list_deferred_prompts returns both types', async () => {
    await tools['create_deferred_prompt']!.execute(
      { prompt: 'Scheduled', schedule: { fire_at: '2026-04-01T09:00:00Z' } },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    )
    await tools['create_deferred_prompt']!.execute(
      { prompt: 'Alert', condition: { field: 'task.status', op: 'eq', value: 'done' } },
      { toolCallId: 'tc2', messages: [], abortSignal: new AbortController().signal },
    )

    const result = await tools['list_deferred_prompts']!.execute(
      {},
      { toolCallId: 'tc3', messages: [], abortSignal: new AbortController().signal },
    )
    expect(result).toHaveProperty('prompts')
    expect(result.prompts).toHaveLength(2)
  })

  test('cancel_deferred_prompt cancels a prompt', async () => {
    const created = await tools['create_deferred_prompt']!.execute(
      { prompt: 'Test', schedule: { fire_at: '2026-04-01T09:00:00Z' } },
      { toolCallId: 'tc1', messages: [], abortSignal: new AbortController().signal },
    )
    const result = await tools['cancel_deferred_prompt']!.execute(
      { id: created.id },
      { toolCallId: 'tc2', messages: [], abortSignal: new AbortController().signal },
    )
    expect(result).toHaveProperty('status', 'cancelled')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/deferred-prompts/tools.test.ts`
Expected: FAIL

**Step 3: Write the implementation**

Create `src/deferred-prompts/tools.ts` with 5 tools using Vercel AI SDK `tool()`.
Each tool wraps the CRUD functions from `scheduled.ts` and `alerts.ts`.

Key structure:

```typescript
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { parseCron } from '../cron.js'
import { logger } from '../logger.js'
import { alertConditionSchema } from './types.js'
import * as scheduledOps from './scheduled.js'
import * as alertOps from './alerts.js'

const log = logger.child({ scope: 'deferred:tools' })

export function makeDeferredPromptTools(userId: string): ToolSet {
  return {
    create_deferred_prompt: tool({
      /* ... */
    }),
    list_deferred_prompts: tool({
      /* ... */
    }),
    get_deferred_prompt: tool({
      /* ... */
    }),
    update_deferred_prompt: tool({
      /* ... */
    }),
    cancel_deferred_prompt: tool({
      /* ... */
    }),
  }
}
```

The `create_deferred_prompt` tool must:

1. Validate mutually exclusive `schedule`/`condition` fields
2. Validate `fire_at` is a future ISO timestamp (for scheduled)
3. Validate `cron` with `parseCron()` (for recurring)
4. Validate `condition` with `alertConditionSchema` (for alerts)
5. Route to `scheduledOps.createScheduledPrompt()` or `alertOps.createAlertPrompt()`

The `list_deferred_prompts` tool merges results from both tables, tagged with their type.

The `get_deferred_prompt` tool looks up in both tables.

The `update_deferred_prompt` tool rejects cross-type field updates (e.g. `condition` on a
scheduled prompt).

The `cancel_deferred_prompt` tool tries both tables and cancels wherever found.

**Step 4: Run test to verify it passes**

Run: `bun test tests/deferred-prompts/tools.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/deferred-prompts/tools.ts tests/deferred-prompts/tools.test.ts
git commit -m "feat: implement 5 unified deferred prompt LLM tools"
```

---

## Phase 5: Poller

### Task 8: Implement the two polling loops

**Files:**

- Create: `src/deferred-prompts/poller.ts`
- Create: `tests/deferred-prompts/poller.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/deferred-prompts/poller.test.ts
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { ModelMessage } from 'ai'

import { mockLogger, mockDrizzle, setupTestDb } from '../utils/test-helpers.js'

mockLogger()
mockDrizzle()

// Mock the ai module for LLM calls
type GenerateTextResult = {
  text: string
  toolCalls: unknown[]
  toolResults: unknown[]
  response: { messages: ModelMessage[] }
}
let generateTextImpl = (): Promise<GenerateTextResult> =>
  Promise.resolve({
    text: 'Done. I archived 3 stale tasks.',
    toolCalls: [],
    toolResults: [],
    response: { messages: [] },
  })

void mock.module('ai', () => ({
  generateText: (..._args: unknown[]): Promise<GenerateTextResult> => generateTextImpl(),
  tool: (opts: unknown): unknown => opts,
  stepCountIs: (_n: number): unknown => undefined,
}))

import { createScheduledPrompt, getScheduledPrompt } from '../../src/deferred-prompts/scheduled.js'
import { createAlertPrompt } from '../../src/deferred-prompts/alerts.js'
import { pollScheduledOnce, pollAlertsOnce } from '../../src/deferred-prompts/poller.js'
import type { ChatProvider } from '../../src/chat/types.js'
import type { TaskProvider } from '../../src/providers/types.js'
import type { AlertCondition } from '../../src/deferred-prompts/types.js'

const createMockChat = (): ChatProvider & { sent: Array<{ userId: string; text: string }> } => {
  const sent: Array<{ userId: string; text: string }> = []
  return {
    name: 'mock',
    sent,
    registerCommand: () => {},
    onMessage: () => {},
    sendMessage: async (userId: string, text: string) => {
      sent.push({ userId, text })
    },
    start: async () => {},
    stop: async () => {},
  }
}

const createMockProvider = (): TaskProvider => ({
  capabilities: new Set(),
  listTasks: async () => [],
  searchTasks: async () => [],
  getTask: async () => ({ id: 't1', title: 'Test', url: '', status: 'done' }),
  createTask: async () => ({ id: 't1', title: '', url: '' }),
  updateTask: async () => ({ id: 't1', title: '', url: '' }),
  getPromptAddendum: () => '',
})

describe('pollScheduledOnce', () => {
  beforeEach(async () => {
    await setupTestDb()
    generateTextImpl = () =>
      Promise.resolve({
        text: 'Done.',
        toolCalls: [],
        toolResults: [],
        response: { messages: [] },
      })
  })

  afterAll(() => {
    mock.restore()
  })

  test('executes a due one-shot prompt and marks completed', async () => {
    const pastDate = new Date(Date.now() - 60_000).toISOString()
    const prompt = createScheduledPrompt('user-1', 'Archive stale tasks', { fireAt: pastDate })

    const chat = createMockChat()
    const buildProvider = () => createMockProvider()

    await pollScheduledOnce(chat, buildProvider)

    // Verify message was sent
    expect(chat.sent).toHaveLength(1)
    expect(chat.sent[0]!.userId).toBe('user-1')
    expect(chat.sent[0]!.text).toBe('Done.')

    // Verify status is completed
    const updated = getScheduledPrompt(prompt.id, 'user-1')
    expect(updated!.status).toBe('completed')
  })

  test('does not execute future prompts', async () => {
    const futureDate = new Date(Date.now() + 3_600_000).toISOString()
    createScheduledPrompt('user-1', 'Not yet', { fireAt: futureDate })

    const chat = createMockChat()
    await pollScheduledOnce(chat, () => createMockProvider())

    expect(chat.sent).toHaveLength(0)
  })

  test('advances recurring prompt to next cron occurrence', async () => {
    const pastDate = new Date(Date.now() - 60_000).toISOString()
    const prompt = createScheduledPrompt('user-1', 'Weekly', {
      fireAt: pastDate,
      cronExpression: '0 9 * * 1',
    })

    const chat = createMockChat()
    await pollScheduledOnce(chat, () => createMockProvider())

    const updated = getScheduledPrompt(prompt.id, 'user-1')
    expect(updated!.status).toBe('active')
    expect(new Date(updated!.fireAt).getTime()).toBeGreaterThan(Date.now())
  })
})

describe('pollAlertsOnce', () => {
  beforeEach(async () => {
    await setupTestDb()
    generateTextImpl = () =>
      Promise.resolve({
        text: 'Alert: task completed.',
        toolCalls: [],
        toolResults: [],
        response: { messages: [] },
      })
  })

  afterAll(() => {
    mock.restore()
  })

  // Alert poller tests would require mocking the provider's listTasks
  // to return tasks that match conditions. The key logic is tested via
  // evaluateCondition unit tests in alerts.test.ts. Integration is
  // verified here with a simpler scenario.

  test('does not trigger when no alerts exist', async () => {
    const chat = createMockChat()
    await pollAlertsOnce(chat, () => createMockProvider())
    expect(chat.sent).toHaveLength(0)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/deferred-prompts/poller.test.ts`
Expected: FAIL

**Step 3: Write the implementation**

Create `src/deferred-prompts/poller.ts`:

```typescript
// src/deferred-prompts/poller.ts
import type { ChatProvider } from '../chat/types.js'
import { getConfig } from '../config.js'
import { nextCronOccurrence, parseCron } from '../cron.js'
import { logger } from '../logger.js'
import { appendHistory } from '../history.js'
import type { TaskProvider } from '../providers/types.js'
import * as scheduledOps from './scheduled.js'
import * as alertOps from './alerts.js'
import { getSnapshotsForUser, updateSnapshots } from './snapshots.js'
import { describeCondition } from './alerts.js'

const log = logger.child({ scope: 'deferred:poller' })

const SCHEDULED_POLL_MS = 60_000 // 60 seconds
const ALERT_POLL_MS = 5 * 60_000 // 5 minutes

let scheduledPollerId: ReturnType<typeof setInterval> | null = null
let alertPollerId: ReturnType<typeof setInterval> | null = null

// The LLM invocation for a deferred prompt.
// Imports generateText dynamically to make mocking easier in tests.
async function invokeLlm(
  userId: string,
  systemPrompt: string,
  userPrompt: string,
  buildProviderFn: (userId: string) => TaskProvider | null,
): Promise<string> {
  const { generateText, stepCountIs } = await import('ai')
  const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
  const { makeTools } = await import('../tools/index.js')

  const llmApiKey = getConfig(userId, 'llm_apikey')
  const llmBaseUrl = getConfig(userId, 'llm_baseurl')
  const mainModel = getConfig(userId, 'main_model')

  if (llmApiKey === null || llmBaseUrl === null || mainModel === null) {
    log.warn({ userId }, 'Missing LLM config for deferred prompt execution')
    return 'Could not execute: LLM not configured.'
  }

  const provider = buildProviderFn(userId)
  if (provider === null) {
    log.warn({ userId }, 'Cannot build provider for deferred prompt')
    return 'Could not execute: task provider not available.'
  }

  const model = createOpenAICompatible({ name: 'openai-compatible', apiKey: llmApiKey, baseURL: llmBaseUrl })(mainModel)
  const tools = makeTools(provider, userId)

  const result = await generateText({
    model,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    tools,
    stopWhen: stepCountIs(25),
  })

  return result.text ?? 'Done.'
}

// Log execution to conversation history
function logToHistory(userId: string, type: string, prompt: string, response: string): void {
  const logMsg = `[Deferred Prompt] Type: ${type}\nPrompt: "${prompt}"\nTriggered at: ${new Date().toISOString()}`
  appendHistory(userId, [
    { role: 'user', content: logMsg },
    { role: 'assistant', content: response },
  ])
}

export async function pollScheduledOnce(
  chat: ChatProvider,
  buildProviderFn: (userId: string) => TaskProvider | null,
): Promise<void> {
  const due = scheduledOps.getScheduledPromptsDue()
  if (due.length === 0) return

  log.debug({ count: due.length }, 'Processing due scheduled prompts')

  for (const prompt of due) {
    try {
      const timezone = getConfig(prompt.userId, 'timezone') ?? 'UTC'
      const systemPrompt = `You are papai, a task management assistant executing a scheduled task.\nUser timezone: ${timezone}.\nExecute the following instruction using available tools. Report results concisely.`

      const response = await invokeLlm(prompt.userId, systemPrompt, prompt.prompt, buildProviderFn)
      await chat.sendMessage(prompt.userId, response)

      logToHistory(prompt.userId, 'scheduled', prompt.prompt, response)

      const now = new Date().toISOString()
      if (prompt.cronExpression !== null) {
        const parsed = parseCron(prompt.cronExpression)
        const next = parsed !== null ? nextCronOccurrence(parsed, new Date(), timezone) : null
        if (next !== null) {
          scheduledOps.advanceScheduledPrompt(prompt.id, next.toISOString(), now)
        } else {
          scheduledOps.completeScheduledPrompt(prompt.id, now)
        }
      } else {
        scheduledOps.completeScheduledPrompt(prompt.id, now)
      }

      log.info({ promptId: prompt.id, userId: prompt.userId }, 'Scheduled prompt executed')
    } catch (error) {
      log.error(
        { promptId: prompt.id, error: error instanceof Error ? error.message : String(error) },
        'Failed to execute scheduled prompt',
      )
    }
  }
}

export async function pollAlertsOnce(
  chat: ChatProvider,
  buildProviderFn: (userId: string) => TaskProvider | null,
): Promise<void> {
  const eligible = alertOps.getEligibleAlertPrompts()
  if (eligible.length === 0) return

  log.debug({ count: eligible.length }, 'Processing eligible alert prompts')

  // Group alerts by user to batch provider calls
  const byUser = new Map<string, typeof eligible>()
  for (const alert of eligible) {
    const list = byUser.get(alert.userId) ?? []
    list.push(alert)
    byUser.set(alert.userId, list)
  }

  for (const [userId, alerts] of byUser) {
    try {
      const provider = buildProviderFn(userId)
      if (provider === null) continue

      // Fetch all tasks for the user
      const tasks = await provider.listTasks({})
      const snapshots = getSnapshotsForUser(userId)

      for (const alert of alerts) {
        const matchedTasks = tasks.filter((t) => alertOps.evaluateCondition(alert.condition, t, snapshots))

        if (matchedTasks.length > 0) {
          const conditionDesc = alertOps.describeCondition(alert.condition)
          const matchedList = matchedTasks.map((t) => `- ${t.title} (${t.id})`).join('\n')
          const timezone = getConfig(userId, 'timezone') ?? 'UTC'
          const systemPrompt = `You are papai, a task management assistant executing an automated alert.\nUser timezone: ${timezone}.\nThe following condition was met: ${conditionDesc}\nMatching tasks:\n${matchedList}\n\nExecute the user's instruction using available tools. Report results concisely.`

          const response = await invokeLlm(userId, systemPrompt, alert.prompt, buildProviderFn)
          await chat.sendMessage(userId, response)

          logToHistory(userId, 'alert', alert.prompt, response)
          alertOps.updateAlertTriggerTime(alert.id, new Date().toISOString())

          log.info({ alertId: alert.id, userId, matchedCount: matchedTasks.length }, 'Alert triggered')
        }
      }

      // Update snapshots regardless of whether any alert fired
      updateSnapshots(userId, tasks)
    } catch (error) {
      log.error(
        { userId, error: error instanceof Error ? error.message : String(error) },
        'Failed to process alerts for user',
      )
    }
  }
}

export function startPollers(chat: ChatProvider, buildProviderFn: (userId: string) => TaskProvider | null): void {
  if (scheduledPollerId !== null) {
    log.warn('Deferred prompt pollers already running')
    return
  }

  scheduledPollerId = setInterval(() => void pollScheduledOnce(chat, buildProviderFn), SCHEDULED_POLL_MS)
  alertPollerId = setInterval(() => void pollAlertsOnce(chat, buildProviderFn), ALERT_POLL_MS)

  // Run initial polls
  void pollScheduledOnce(chat, buildProviderFn)
  void pollAlertsOnce(chat, buildProviderFn)

  log.info(
    { scheduledIntervalMs: SCHEDULED_POLL_MS, alertIntervalMs: ALERT_POLL_MS },
    'Deferred prompt pollers started',
  )
}

export function stopPollers(): void {
  if (scheduledPollerId !== null) {
    clearInterval(scheduledPollerId)
    scheduledPollerId = null
  }
  if (alertPollerId !== null) {
    clearInterval(alertPollerId)
    alertPollerId = null
  }
  log.info('Deferred prompt pollers stopped')
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/deferred-prompts/poller.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/deferred-prompts/poller.ts tests/deferred-prompts/poller.test.ts
git commit -m "feat: implement deferred prompt polling loops"
```

---

## Phase 6: Index & Integration

### Task 9: Create the deferred-prompts index module

**Files:**

- Create: `src/deferred-prompts/index.ts`

**Step 1: Create the barrel export**

```typescript
// src/deferred-prompts/index.ts
export type { ScheduledPrompt, AlertPrompt, DeferredPrompt, AlertCondition, LeafCondition } from './types.js'
export { alertConditionSchema, CONDITION_FIELDS, FIELD_OPERATORS } from './types.js'
export { makeDeferredPromptTools } from './tools.js'
export { startPollers, stopPollers, pollScheduledOnce, pollAlertsOnce } from './poller.js'
```

**Step 2: Commit**

```bash
git add src/deferred-prompts/index.ts
git commit -m "feat: add deferred-prompts barrel export"
```

---

### Task 10: Wire deferred prompts into the bot

**Files:**

- Modify: `src/index.ts` — replace proactive scheduler with deferred prompt pollers
- Modify: `src/tools/index.ts` — replace proactive tools with deferred prompt tools
- Modify: `src/llm-orchestrator.ts` — remove briefing catch-up hook and update system prompt

**Step 1: Update `src/index.ts`**

Replace line 8:

```typescript
// OLD: import { proactiveScheduler } from './proactive/index.js'
// NEW:
import { startPollers, stopPollers } from './deferred-prompts/poller.js'
```

Replace line 107:

```typescript
// OLD: proactiveScheduler.start(chatProvider, buildProviderForUser)
// NEW:
startPollers(chatProvider, buildProviderForUser)
```

Replace lines 112 and 122 (both SIGINT and SIGTERM handlers):

```typescript
// OLD: proactiveScheduler.stopAll()
// NEW:
stopPollers()
```

**Step 2: Update `src/tools/index.ts`**

Replace line 3:

```typescript
// OLD: import { makeProactiveTools } from '../proactive/tools.js'
// NEW:
import { makeDeferredPromptTools } from '../deferred-prompts/tools.js'
```

Replace lines 174-177:

```typescript
// OLD:
// if (userId !== undefined) {
//   const proactiveTools = makeProactiveTools(userId, provider)
//   Object.assign(tools, proactiveTools)
// }
// NEW:
if (userId !== undefined) {
  const deferredTools = makeDeferredPromptTools(userId)
  Object.assign(tools, deferredTools)
}
```

**Step 3: Update `src/llm-orchestrator.ts`**

Remove line 14:

```typescript
// DELETE: import * as briefingService from './proactive/briefing.js'
```

Remove lines 278-281 (the briefing catch-up block):

```typescript
// DELETE:
// if (checkRequiredConfig(contextId).length === 0) {
//   const catchUp = await briefingService.getMissedBriefing(contextId, buildProvider(contextId)).catch(() => null)
//   if (catchUp !== null) await reply.formatted(catchUp)
// }
```

Update the system prompt (lines 100-108) to replace REMINDERS section with DEFERRED PROMPTS:

```typescript
// Replace the REMINDERS block with:
DEFERRED PROMPTS — The user can set up automated tasks and alerts:
- SCHEDULED PROMPTS: Use create_deferred_prompt with a schedule to set up one-time or recurring LLM tasks.
  - One-time: provide schedule.fire_at as an ISO 8601 timestamp. Resolve natural language times.
  - Recurring: provide schedule.cron as a 5-field cron expression. Cron times are interpreted in the user's timezone (${timezone}).
- ALERTS: Use create_deferred_prompt with a condition to monitor task changes.
  - Conditions use a filter schema: { field, op, value }. Fields: task.status, task.priority, task.assignee, task.dueDate, task.updatedAt, task.project, task.labels.
  - Operators: eq, neq, changed_to, lt, gt, overdue, stale_days, contains, not_contains.
  - Combine with { and: [...] } or { or: [...] }.
  - Set cooldown_minutes to control how often alerts can fire (default: 60 minutes).
- Use list_deferred_prompts to show active prompts/alerts. Use cancel_deferred_prompt to cancel one.
- For daily briefings, create a recurring scheduled prompt (e.g., "0 9 * * *" cron at 9am).
```

**Step 4: Run typecheck to verify no broken imports**

Run: `bun typecheck`
Expected: PASS (possibly with existing unrelated errors from proactive/ — those will be
cleaned up in Task 11)

**Step 5: Commit**

```bash
git add src/index.ts src/tools/index.ts src/llm-orchestrator.ts
git commit -m "feat: wire deferred prompts into bot, replace proactive system"
```

---

### Task 11: Remove old proactive system

**Files:**

- Delete: `src/proactive/` (entire directory)
- Delete: `tests/proactive/` (entire directory)
- Modify: `src/types/config.ts` — remove `InternalConfigKey` type
- Modify: `src/db/schema.ts` — remove old table definitions (if not already done in Task 2)

**Step 1: Delete old directories**

```bash
rm -rf src/proactive/ tests/proactive/
```

**Step 2: Update `src/types/config.ts`**

Remove line 12:

```typescript
// DELETE: export type InternalConfigKey = 'briefing_time' | 'deadline_nudges' | 'staleness_days'
```

Update line 18:

```typescript
// OLD: export type ConfigKey = TaskProviderConfigKey | LlmConfigKey | PreferenceConfigKey | InternalConfigKey
// NEW:
export type ConfigKey = TaskProviderConfigKey | LlmConfigKey | PreferenceConfigKey
```

**Step 3: Remove old schema types from `src/db/schema.ts`**

Verify that old `reminders`, `userBriefingState`, `alertState` tables and their types
(`Reminder`, `UserBriefingState`, `AlertStateRow`) were already removed in Task 2.
If not, remove them now.

**Step 4: Run full check suite**

Run: `bun typecheck && bun lint && bun test`
Expected: PASS (the full suite should work since proactive tests are gone and new deferred
prompt tests cover the replacement)

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove old proactive system (reminders, briefings, alerts)"
```

---

## Phase 7: Final Verification

### Task 12: Run full check suite and fix any issues

**Step 1: Run all checks**

```bash
bun check
```

This runs lint, typecheck, format:check, knip, test, and security in parallel.

**Step 2: Fix any failures**

Common issues to watch for:

- Unused imports referencing old proactive code
- Config keys that reference old `InternalConfigKey` values
- Knip detecting unused exports in old modules (should be gone after deletion)
- Formatting issues in new files (run `bun fix` to auto-fix)

**Step 3: Run E2E tests if Docker is available**

```bash
bun test:e2e
```

E2E tests should still pass since they test Kaneo operations, not the proactive system.

**Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve check failures after deferred prompts migration"
```

---

## Summary

| Phase | Tasks | What it builds                                    |
| ----- | ----- | ------------------------------------------------- |
| 1     | 1-2   | Database migration + Drizzle schema               |
| 2     | 3     | Types and Zod validation                          |
| 3     | 4-6   | CRUD for scheduled prompts, alerts, and snapshots |
| 4     | 7     | 5 unified LLM tools                               |
| 5     | 8     | Two polling loops                                 |
| 6     | 9-11  | Integration wiring + old system removal           |
| 7     | 12    | Final verification                                |

**New files:** 14 (7 src + 7 tests)
**Deleted files:** ~13 (8 src/proactive + 5 tests/proactive)
**Modified files:** 5 (index.ts, tools/index.ts, llm-orchestrator.ts, types/config.ts, db/schema.ts)
