# Deferred Prompt Execution Modes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Introduce three execution modes (lightweight, context, full) for deferred prompts so that fire-time resource loading scales with prompt complexity.

**Architecture:** The creating LLM classifies each prompt at creation time into a mode and produces a delivery brief + optional context snapshot. At fire time, a dispatcher routes to one of three execution functions, each loading only the resources its mode requires. A new `execution_metadata` JSON column on both prompt tables stores the classification.

**Tech Stack:** Bun, Drizzle ORM (SQLite), Vercel AI SDK, Zod v4, pino

---

### Task 1: Database Migration — Add `execution_metadata` Column

**Files:**

- Create: `src/db/migrations/016_execution_metadata.ts`
- Modify: `src/db/index.ts:19,61` (add import and register migration)

**Step 1: Write the migration file**

```typescript
// src/db/migrations/016_execution_metadata.ts
import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration016ExecutionMetadata: Migration = {
  id: '016_execution_metadata',
  up(db: Database): void {
    db.run(`ALTER TABLE scheduled_prompts ADD COLUMN execution_metadata TEXT NOT NULL DEFAULT '{}'`)
    db.run(`ALTER TABLE alert_prompts ADD COLUMN execution_metadata TEXT NOT NULL DEFAULT '{}'`)
  },
}
```

**Step 2: Register the migration in `src/db/index.ts`**

Add after line 19:

```typescript
import { migration016ExecutionMetadata } from './migrations/016_execution_metadata.js'
```

Add `migration016ExecutionMetadata` to the end of the `MIGRATIONS` array (after `migration015DropBackgroundEvents`).

**Step 3: Run typecheck to verify**

Run: `bun typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/db/migrations/016_execution_metadata.ts src/db/index.ts
git commit -m "feat(db): add execution_metadata column to deferred prompt tables"
```

---

### Task 2: Update Drizzle Schema

**Files:**

- Modify: `src/db/schema.ts:120-155` (add column to both tables)

**Step 1: Add `executionMetadata` column to `scheduledPrompts`**

In `src/db/schema.ts`, inside the `scheduledPrompts` table definition (after `lastExecutedAt` on line 132), add:

```typescript
    executionMetadata: text('execution_metadata').notNull().default('{}'),
```

**Step 2: Add `executionMetadata` column to `alertPrompts`**

In `src/db/schema.ts`, inside the `alertPrompts` table definition (after `cooldownMinutes` on line 152), add:

```typescript
    executionMetadata: text('execution_metadata').notNull().default('{}'),
```

**Step 3: Run typecheck to verify**

Run: `bun typecheck`
Expected: PASS — `ScheduledPromptRow` and `AlertPromptRow` are inferred types, so they auto-gain `executionMetadata: string`.

**Step 4: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat(schema): add executionMetadata column to scheduled and alert prompt tables"
```

---

### Task 3: Update Domain Types

**Files:**

- Modify: `src/deferred-prompts/types.ts:71-95`

**Step 1: Add `ExecutionMetadata` type and `executionMetadataSchema`**

After the `alertConditionSchema` export (line 69) and before the domain types comment (line 71), add:

```typescript
// --- Execution metadata ---

export const EXECUTION_MODES = ['lightweight', 'context', 'full'] as const
export type ExecutionMode = (typeof EXECUTION_MODES)[number]

export const executionMetadataSchema = z.object({
  mode: z.enum(EXECUTION_MODES),
  delivery_brief: z.string(),
  context_snapshot: z.string().nullable().default(null),
})

export type ExecutionMetadata = z.infer<typeof executionMetadataSchema>

export const DEFAULT_EXECUTION_METADATA: ExecutionMetadata = {
  mode: 'full',
  delivery_brief: '',
  context_snapshot: null,
}
```

**Step 2: Add `executionMetadata` field to `ScheduledPrompt` type**

Add after `lastExecutedAt` (line 82):

```typescript
executionMetadata: ExecutionMetadata
```

**Step 3: Add `executionMetadata` field to `AlertPrompt` type**

Add after `cooldownMinutes` (line 94):

```typescript
executionMetadata: ExecutionMetadata
```

**Step 4: Run typecheck**

Run: `bun typecheck`
Expected: FAIL — `toScheduledPrompt` and `toAlertPrompt` mappers don't set the new field yet. That's expected, we fix them in Task 4.

**Step 5: Commit**

```bash
git add src/deferred-prompts/types.ts
git commit -m "feat(types): add ExecutionMetadata type and schema for deferred prompts"
```

---

### Task 4: Update Row Mappers in `scheduled.ts` and `alerts.ts`

**Files:**

- Modify: `src/deferred-prompts/scheduled.ts:19-31` (toScheduledPrompt)
- Modify: `src/deferred-prompts/alerts.ts:15-25` (toAlertPrompt)

**Step 1: Update `toScheduledPrompt` in `scheduled.ts`**

Add import at the top of `src/deferred-prompts/scheduled.ts`:

```typescript
import { DEFAULT_EXECUTION_METADATA, executionMetadataSchema, type ExecutionMetadata } from './types.js'
```

Replace the existing `toScheduledPrompt` function (lines 19-31):

```typescript
function parseExecutionMetadata(raw: string): ExecutionMetadata {
  try {
    const parsed: unknown = JSON.parse(raw)
    const result = executionMetadataSchema.safeParse(parsed)
    return result.success ? result.data : DEFAULT_EXECUTION_METADATA
  } catch {
    return DEFAULT_EXECUTION_METADATA
  }
}

function toScheduledPrompt(row: ScheduledPromptRow): ScheduledPrompt {
  return {
    type: 'scheduled',
    id: row.id,
    userId: row.userId,
    prompt: row.prompt,
    fireAt: row.fireAt,
    cronExpression: row.cronExpression,
    status: toStatus(row.status),
    createdAt: row.createdAt,
    lastExecutedAt: row.lastExecutedAt,
    executionMetadata: parseExecutionMetadata(row.executionMetadata),
  }
}
```

**Step 2: Update `createScheduledPrompt` to accept and store `executionMetadata`**

Change the function signature (line 33) to accept an optional `executionMetadata` parameter:

```typescript
export function createScheduledPrompt(
  userId: string,
  prompt: string,
  schedule: { fireAt: string; cronExpression?: string },
  executionMetadata?: ExecutionMetadata,
): ScheduledPrompt {
```

In the `db.insert` values (line 45), add:

```typescript
      executionMetadata: JSON.stringify(executionMetadata ?? DEFAULT_EXECUTION_METADATA),
```

**Step 3: Update `updateScheduledPrompt` to accept `executionMetadata`**

Add `executionMetadata?: ExecutionMetadata` to the `updates` parameter type (line 113):

```typescript
  updates: { prompt?: string; fireAt?: string; cronExpression?: string; executionMetadata?: ExecutionMetadata },
```

In `buildUpdateValues`, add handling for executionMetadata:

```typescript
if (updates.executionMetadata !== undefined) values.executionMetadata = JSON.stringify(updates.executionMetadata)
```

**Step 4: Update `toAlertPrompt` in `alerts.ts`**

Add import at the top of `src/deferred-prompts/alerts.ts`:

```typescript
import {
  alertConditionSchema,
  DEFAULT_EXECUTION_METADATA,
  executionMetadataSchema,
  type AlertCondition,
  type AlertPrompt,
  type ExecutionMetadata,
  type LeafCondition,
} from './types.js'
```

Add the same `parseExecutionMetadata` helper (or extract to a shared function in `types.ts`). Then update `toAlertPrompt`:

```typescript
const toAlertPrompt = (row: AlertPromptRow): AlertPrompt => ({
  type: 'alert',
  id: row.id,
  userId: row.userId,
  prompt: row.prompt,
  condition: alertConditionSchema.parse(JSON.parse(row.condition)),
  status: parseStatus(row.status),
  createdAt: row.createdAt,
  lastTriggeredAt: row.lastTriggeredAt,
  cooldownMinutes: row.cooldownMinutes,
  executionMetadata: parseExecutionMetadata(row.executionMetadata),
})
```

**Step 5: Update `createAlertPrompt` to accept and store `executionMetadata`**

Change the function signature to accept an optional `executionMetadata` parameter:

```typescript
export const createAlertPrompt = (
  userId: string,
  prompt: string,
  condition: AlertCondition,
  cooldownMinutes?: number,
  executionMetadata?: ExecutionMetadata,
): AlertPrompt => {
```

In the `db.insert` values, add:

```typescript
      executionMetadata: JSON.stringify(executionMetadata ?? DEFAULT_EXECUTION_METADATA),
```

**Step 6: Update `updateAlertPrompt` to accept `executionMetadata`**

Add `executionMetadata?: ExecutionMetadata` to the updates parameter:

```typescript
  updates: { prompt?: string; condition?: AlertCondition; cooldownMinutes?: number; executionMetadata?: ExecutionMetadata },
```

Add handling in the set block:

```typescript
if (updates.executionMetadata !== undefined) set.executionMetadata = JSON.stringify(updates.executionMetadata)
```

**Step 7: Run typecheck**

Run: `bun typecheck`
Expected: PASS

**Step 8: Run existing tests**

Run: `bun test tests/deferred-prompts/`
Expected: PASS — existing tests don't set `executionMetadata`, so the default `'{}'` applies and `parseExecutionMetadata` returns `DEFAULT_EXECUTION_METADATA`.

**Step 9: Commit**

```bash
git add src/deferred-prompts/scheduled.ts src/deferred-prompts/alerts.ts
git commit -m "feat(deferred): update row mappers and CRUD to handle executionMetadata"
```

---

### Task 5: Update Migration Test

**Files:**

- Modify: `tests/deferred-prompts/migration.test.ts`
- Modify: `tests/utils/test-helpers.ts:28,50` (add migration import and registration)

**Step 1: Add migration to test helpers**

In `tests/utils/test-helpers.ts`, add the import after line 28:

```typescript
import { migration016ExecutionMetadata } from '../../src/db/migrations/016_execution_metadata.js'
```

Add `migration016ExecutionMetadata` to the end of the `ALL_MIGRATIONS` array (after line 50).

**Step 2: Add migration to `tests/deferred-prompts/migration.test.ts`**

Add the import after line 19:

```typescript
import { migration016ExecutionMetadata } from '../../src/db/migrations/016_execution_metadata.js'
```

Add `migration016ExecutionMetadata` to the `ALL_MIGRATIONS` array.

Add a new test:

```typescript
describe('migration 016: execution metadata', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db, [...ALL_MIGRATIONS])
  })

  afterAll(() => {
    db.close()
  })

  test('adds execution_metadata to scheduled_prompts', () => {
    const columns = getColumnNames(db, 'scheduled_prompts')
    expect(columns).toContain('execution_metadata')
  })

  test('adds execution_metadata to alert_prompts', () => {
    const columns = getColumnNames(db, 'alert_prompts')
    expect(columns).toContain('execution_metadata')
  })

  test('default value is empty JSON object', () => {
    db.run(
      "INSERT INTO scheduled_prompts (id, user_id, prompt, fire_at, status) VALUES ('t1', 'u1', 'test', '2026-01-01T00:00:00Z', 'active')",
    )
    const row = db
      .query<{ execution_metadata: string }, []>("SELECT execution_metadata FROM scheduled_prompts WHERE id = 't1'")
      .get()
    expect(row?.execution_metadata).toBe('{}')
  })
})
```

**Step 3: Run the migration test**

Run: `bun test tests/deferred-prompts/migration.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add tests/deferred-prompts/migration.test.ts tests/utils/test-helpers.ts
git commit -m "test(migration): add tests for execution_metadata column migration"
```

---

### Task 6: Update Tool Schemas — Add `execution` Parameter

**Files:**

- Modify: `src/deferred-prompts/tools.ts:31,114,189-224,257-276`

**Step 1: Add execution schema and import**

Add to the imports from `./types.js`:

```typescript
import {
  alertConditionSchema,
  DEFAULT_EXECUTION_METADATA,
  executionMetadataSchema,
  type AlertCondition,
  type CancelResult,
  type CreateResult,
  type ExecutionMetadata,
  type GetResult,
  type ListResult,
  type UpdateResult,
} from './types.js'
```

**Step 2: Update `CreateInput` type**

Change the `CreateInput` type (line 31) to include `execution`:

```typescript
type CreateInput = {
  prompt: string
  schedule?: ScheduleInput
  condition?: AlertCondition
  cooldown_minutes?: number
  execution?: { mode: 'lightweight' | 'context' | 'full'; delivery_brief: string; context_snapshot?: string }
}
```

**Step 3: Pass `executionMetadata` to `createScheduled` and `createAlert`**

In `executeCreate` (line 83), parse the execution input and pass it through:

```typescript
function executeCreate(userId: string, input: CreateInput): CreateResult {
  const hasSchedule = input.schedule !== undefined
  const hasCondition = input.condition !== undefined
  log.debug({ userId, hasSchedule, hasCondition }, 'create_deferred_prompt called')
  if (hasSchedule && hasCondition) return { error: 'Provide either a schedule or a condition, not both.' }
  if (!hasSchedule && !hasCondition) {
    return { error: 'Provide either a schedule (for time-based) or a condition (for event-based).' }
  }

  let executionMetadata: ExecutionMetadata = DEFAULT_EXECUTION_METADATA
  if (input.execution !== undefined) {
    const parseResult = executionMetadataSchema.safeParse(input.execution)
    if (parseResult.success) {
      executionMetadata = parseResult.data
    } else {
      log.warn({ userId, error: parseResult.error.message }, 'Invalid execution metadata, using default')
    }
  }

  if (hasSchedule) return createScheduled(userId, input.prompt, input.schedule!, executionMetadata)
  return createAlert(userId, input.prompt, input.condition, input.cooldown_minutes, executionMetadata)
}
```

**Step 4: Update `createScheduled` to pass through `executionMetadata`**

Change the `createScheduled` function signature:

```typescript
function createScheduled(userId: string, prompt: string, schedule: ScheduleInput, executionMetadata: ExecutionMetadata): CreateResult {
```

Pass it to `createScheduledPrompt`:

```typescript
const result = createScheduledPrompt(userId, prompt, { fireAt, cronExpression }, executionMetadata)
```

**Step 5: Update `createAlert` to pass through `executionMetadata`**

Change the `createAlert` function signature:

```typescript
function createAlert(userId: string, prompt: string, condition: unknown, cooldownMinutes: number | undefined, executionMetadata: ExecutionMetadata): CreateResult {
```

Pass it to `createAlertPrompt`:

```typescript
const result = createAlertPrompt(userId, prompt, parseResult.data, cooldownMinutes, executionMetadata)
```

**Step 6: Update `UpdateInput` type and handlers**

Add `execution` to `UpdateInput`:

```typescript
type UpdateInput = {
  id: string
  prompt?: string
  schedule?: ScheduleInput
  condition?: AlertCondition
  cooldown_minutes?: number
  execution?: { mode: 'lightweight' | 'context' | 'full'; delivery_brief: string; context_snapshot?: string }
}
```

In `updateScheduledFields`, parse and pass `executionMetadata`:

```typescript
if (input.execution !== undefined) {
  const parseResult = executionMetadataSchema.safeParse(input.execution)
  if (parseResult.success) updates.executionMetadata = parseResult.data
}
```

Same for `updateAlertFields`.

**Step 7: Update tool descriptions and input schemas**

In `makeCreateTool`, add the `execution` parameter to `inputSchema` and update the description:

```typescript
function makeCreateTool(userId: string): ToolSet[string] {
  return tool({
    description:
      'Create a scheduled task or monitoring alert. Provide either a schedule (for time-based) or a condition (for event-based), not both. Always classify the execution mode based on what the prompt needs at fire time.',
    inputSchema: z.object({
      prompt: z.string().describe('What to do/say when this fires — not scheduling meta-instructions'),
      schedule: scheduleSchema.optional().describe('Time-based trigger (one-time or recurring)'),
      condition: alertConditionSchema.optional().describe('Event-based trigger condition'),
      cooldown_minutes: cooldownSchema,
      execution: z
        .object({
          mode: z
            .enum(['lightweight', 'context', 'full'])
            .describe(
              'lightweight: simple reminders/nudges needing no tools or history. context: needs conversation history but no tools. full: needs live task tracker operations.',
            ),
          delivery_brief: z
            .string()
            .describe('Freeform instructions for the executing LLM: intent, tone, key details, entities to reference.'),
          context_snapshot: z
            .string()
            .optional()
            .describe(
              'When the user references something from the current conversation, distill only the relevant parts into a summary here.',
            ),
        })
        .optional()
        .describe('Execution mode classification and delivery instructions for the firing LLM.'),
    }),
    execute: (input: CreateInput) => {
      try {
        return executeCreate(userId, input)
      } catch (e) {
        logAndRethrow('create_deferred_prompt', e)
      }
    },
  })
}
```

In `makeUpdateTool`, add the same `execution` schema as optional.

**Step 8: Run typecheck and tests**

Run: `bun typecheck && bun test tests/deferred-prompts/tools.test.ts`
Expected: PASS — existing tests don't provide `execution`, so it defaults.

**Step 9: Commit**

```bash
git add src/deferred-prompts/tools.ts
git commit -m "feat(tools): add execution parameter to create/update deferred prompt tools"
```

---

### Task 7: Write Failing Tests for Execution Mode Dispatch

**Files:**

- Create: `tests/deferred-prompts/execution-modes.test.ts`

**Step 1: Write the test file**

```typescript
// tests/deferred-prompts/execution-modes.test.ts
//
// Mocked modules: ai, @ai-sdk/openai-compatible, ../src/logger.js, ../src/db/drizzle.js
// (Uses mockLogger + mockDrizzle helpers; mocks ai + openai-compatible directly)
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import { mockLogger, mockDrizzle, setupTestDb } from '../utils/test-helpers.js'

mockLogger()
mockDrizzle()

// Track generateText calls
type GenerateTextResult = {
  text: string
  toolCalls: unknown[]
  toolResults: unknown[]
  response: { messages: ModelMessage[] }
}
type GenerateTextCall = { model: unknown; system: unknown; messages: unknown[]; tools: unknown }
const generateTextCalls: GenerateTextCall[] = []

let generateTextImpl = (args: GenerateTextCall): Promise<GenerateTextResult> => {
  generateTextCalls.push(args)
  return Promise.resolve({ text: 'Mock response', toolCalls: [], toolResults: [], response: { messages: [] } })
}

void mock.module('ai', () => ({
  generateText: (args: GenerateTextCall): Promise<GenerateTextResult> => generateTextImpl(args),
  tool: (opts: unknown): unknown => opts,
  stepCountIs: (_n: number): unknown => undefined,
}))

void mock.module('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible:
    (opts: { name: string; apiKey: string; baseURL: string }): ((modelId: string) => string) =>
    (modelId: string): string =>
      `${opts.name}:${modelId}`,
}))

import { setConfig } from '../../src/config.js'
import { appendHistory } from '../../src/history.js'
import type { ExecutionMetadata } from '../../src/deferred-prompts/types.js'

// Import after mocks
import { dispatchExecution } from '../../src/deferred-prompts/proactive-llm.js'
import { createMockProvider } from '../tools/mock-provider.js'

const USER_ID = 'exec-mode-user'

function setupUserConfig(opts?: { smallModel?: string }): void {
  setConfig(USER_ID, 'llm_apikey', 'test-key')
  setConfig(USER_ID, 'llm_baseurl', 'http://localhost:11434/v1')
  setConfig(USER_ID, 'main_model', 'main-model')
  setConfig(USER_ID, 'timezone', 'UTC')
  if (opts?.smallModel !== undefined) {
    setConfig(USER_ID, 'small_model', opts.smallModel)
  }
}

afterAll(() => {
  mock.restore()
})

beforeEach(async () => {
  await setupTestDb()
  generateTextCalls.length = 0
  generateTextImpl = (args: GenerateTextCall): Promise<GenerateTextResult> => {
    generateTextCalls.push(args)
    return Promise.resolve({ text: 'Mock response', toolCalls: [], toolResults: [], response: { messages: [] } })
  }
})

describe('dispatchExecution', () => {
  describe('lightweight mode', () => {
    const metadata: ExecutionMetadata = {
      mode: 'lightweight',
      delivery_brief: 'Friendly hydration reminder',
      context_snapshot: null,
    }

    test('uses small_model when configured', async () => {
      setupUserConfig({ smallModel: 'small-model' })
      await dispatchExecution(USER_ID, 'scheduled', 'drink water', metadata, () => null)
      expect(generateTextCalls).toHaveLength(1)
      expect(generateTextCalls[0]!.model).toContain('small-model')
    })

    test('falls back to main_model when small_model not set', async () => {
      setupUserConfig()
      await dispatchExecution(USER_ID, 'scheduled', 'drink water', metadata, () => null)
      expect(generateTextCalls).toHaveLength(1)
      expect(generateTextCalls[0]!.model).toContain('main-model')
    })

    test('does not include tools', async () => {
      setupUserConfig()
      await dispatchExecution(USER_ID, 'scheduled', 'drink water', metadata, () => null)
      expect(generateTextCalls[0]!.tools).toBeUndefined()
    })

    test('uses minimal system prompt', async () => {
      setupUserConfig()
      await dispatchExecution(USER_ID, 'scheduled', 'drink water', metadata, () => null)
      const system = generateTextCalls[0]!.system as string
      expect(system).toContain('[PROACTIVE EXECUTION]')
      expect(system).not.toContain('DEFERRED PROMPTS')
    })

    test('includes delivery brief in messages', async () => {
      setupUserConfig()
      await dispatchExecution(USER_ID, 'scheduled', 'drink water', metadata, () => null)
      const messages = generateTextCalls[0]!.messages as ModelMessage[]
      const systemMsgs = messages.filter((m) => m.role === 'system')
      expect(systemMsgs.some((m) => typeof m.content === 'string' && m.content.includes('[DELIVERY BRIEF]'))).toBe(true)
      expect(
        systemMsgs.some((m) => typeof m.content === 'string' && m.content.includes('Friendly hydration reminder')),
      ).toBe(true)
    })

    test('wraps prompt in deferred task delimiters', async () => {
      setupUserConfig()
      await dispatchExecution(USER_ID, 'scheduled', 'drink water', metadata, () => null)
      const messages = generateTextCalls[0]!.messages as ModelMessage[]
      const userMsgs = messages.filter((m) => m.role === 'user')
      expect(userMsgs.some((m) => typeof m.content === 'string' && m.content.includes('===DEFERRED_TASK==='))).toBe(
        true,
      )
      expect(userMsgs.some((m) => typeof m.content === 'string' && m.content.includes('drink water'))).toBe(true)
    })

    test('does not load conversation history', async () => {
      setupUserConfig()
      // Add history that should NOT appear in lightweight mode
      appendHistory(USER_ID, [{ role: 'user', content: 'old message' }])
      await dispatchExecution(USER_ID, 'scheduled', 'drink water', metadata, () => null)
      const messages = generateTextCalls[0]!.messages as ModelMessage[]
      expect(messages.some((m) => typeof m.content === 'string' && m.content.includes('old message'))).toBe(false)
    })

    test('includes context snapshot when present', async () => {
      setupUserConfig()
      const withSnapshot: ExecutionMetadata = { ...metadata, context_snapshot: 'User discussed migration' }
      await dispatchExecution(USER_ID, 'scheduled', 'remind about migration', withSnapshot, () => null)
      const messages = generateTextCalls[0]!.messages as ModelMessage[]
      const systemMsgs = messages.filter((m) => m.role === 'system')
      expect(
        systemMsgs.some((m) => typeof m.content === 'string' && m.content.includes('[CONTEXT FROM CREATION TIME]')),
      ).toBe(true)
    })

    test('omits context snapshot message when null', async () => {
      setupUserConfig()
      await dispatchExecution(USER_ID, 'scheduled', 'drink water', metadata, () => null)
      const messages = generateTextCalls[0]!.messages as ModelMessage[]
      expect(
        messages.some(
          (m) => typeof m.content === 'string' && String(m.content).includes('[CONTEXT FROM CREATION TIME]'),
        ),
      ).toBe(false)
    })
  })

  describe('context mode', () => {
    const metadata: ExecutionMetadata = {
      mode: 'context',
      delivery_brief: 'Remind about the standup discussion',
      context_snapshot: 'Discussed Q2 sprint priorities',
    }

    test('uses main_model', async () => {
      setupUserConfig()
      await dispatchExecution(USER_ID, 'scheduled', 'standup reminder', metadata, () => null)
      expect(generateTextCalls[0]!.model).toContain('main-model')
    })

    test('loads conversation history', async () => {
      setupUserConfig()
      appendHistory(USER_ID, [{ role: 'user', content: 'history message' }])
      await dispatchExecution(USER_ID, 'scheduled', 'standup reminder', metadata, () => null)
      const messages = generateTextCalls[0]!.messages as ModelMessage[]
      expect(messages.some((m) => typeof m.content === 'string' && m.content.includes('history message'))).toBe(true)
    })

    test('does not include tools', async () => {
      setupUserConfig()
      await dispatchExecution(USER_ID, 'scheduled', 'standup reminder', metadata, () => null)
      expect(generateTextCalls[0]!.tools).toBeUndefined()
    })

    test('uses minimal system prompt', async () => {
      setupUserConfig()
      await dispatchExecution(USER_ID, 'scheduled', 'standup reminder', metadata, () => null)
      const system = generateTextCalls[0]!.system as string
      expect(system).toContain('[PROACTIVE EXECUTION]')
    })
  })

  describe('full mode', () => {
    const metadata: ExecutionMetadata = {
      mode: 'full',
      delivery_brief: 'Check overdue tasks grouped by project',
      context_snapshot: null,
    }

    test('uses main_model', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      await dispatchExecution(USER_ID, 'scheduled', 'check overdue', metadata, () => provider)
      expect(generateTextCalls[0]!.model).toContain('main-model')
    })

    test('includes tools', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      await dispatchExecution(USER_ID, 'scheduled', 'check overdue', metadata, () => provider)
      expect(generateTextCalls[0]!.tools).toBeDefined()
    })

    test('uses full system prompt', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      await dispatchExecution(USER_ID, 'scheduled', 'check overdue', metadata, () => provider)
      const system = generateTextCalls[0]!.system as string
      // Full system prompt includes provider-specific content
      expect(system.length).toBeGreaterThan(200)
    })

    test('loads conversation history', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      appendHistory(USER_ID, [{ role: 'user', content: 'full mode history' }])
      await dispatchExecution(USER_ID, 'scheduled', 'check overdue', metadata, () => provider)
      const messages = generateTextCalls[0]!.messages as ModelMessage[]
      expect(messages.some((m) => typeof m.content === 'string' && m.content.includes('full mode history'))).toBe(true)
    })

    test('returns error when provider cannot be built', async () => {
      setupUserConfig()
      const result = await dispatchExecution(USER_ID, 'scheduled', 'check overdue', metadata, () => null)
      expect(result).toContain('task provider not configured')
    })
  })

  describe('fallback behavior', () => {
    test('treats empty metadata as full mode', async () => {
      setupUserConfig()
      const emptyMetadata: ExecutionMetadata = { mode: 'full', delivery_brief: '', context_snapshot: null }
      const provider = createMockProvider()
      await dispatchExecution(USER_ID, 'scheduled', 'test', emptyMetadata, () => provider)
      expect(generateTextCalls[0]!.tools).toBeDefined()
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/deferred-prompts/execution-modes.test.ts`
Expected: FAIL — `dispatchExecution` doesn't exist yet in `proactive-llm.ts`.

**Step 3: Commit**

```bash
git add tests/deferred-prompts/execution-modes.test.ts
git commit -m "test(deferred): add failing tests for execution mode dispatch"
```

---

### Task 8: Implement Three Execution Functions and Dispatcher

**Files:**

- Modify: `src/deferred-prompts/proactive-llm.ts` (major refactor)

**Step 1: Add the minimal system prompt builder**

Add after `formatLocalTime` function:

```typescript
function buildMinimalSystemPrompt(type: 'scheduled' | 'alert', timezone: string): string {
  const { currentTime, displayTimezone } = formatLocalTime(timezone)
  return [
    '[PROACTIVE EXECUTION]',
    `Current time: ${currentTime} (${displayTimezone})`,
    `Trigger type: ${type}`,
    '',
    'A deferred prompt has fired. Deliver the result warmly and conversationally.',
    'Do not mention scheduling, triggers, or system events.',
    'Do not create new deferred prompts.',
  ].join('\n')
}
```

**Step 2: Add message construction helpers**

```typescript
import type { ExecutionMetadata } from './types.js'

function buildMetadataMessages(metadata: ExecutionMetadata): ModelMessage[] {
  const messages: ModelMessage[] = [{ role: 'system', content: `[DELIVERY BRIEF]\n${metadata.delivery_brief}` }]
  if (metadata.context_snapshot !== null) {
    messages.push({ role: 'system', content: `[CONTEXT FROM CREATION TIME]\n${metadata.context_snapshot}` })
  }
  return messages
}

function wrapPrompt(prompt: string): string {
  return `===DEFERRED_TASK===\n${prompt}\n===END_DEFERRED_TASK===`
}
```

**Step 3: Implement `invokeLightweight`**

```typescript
async function invokeLightweight(
  userId: string,
  type: 'scheduled' | 'alert',
  prompt: string,
  metadata: ExecutionMetadata,
): Promise<string> {
  log.debug({ userId, mode: 'lightweight' }, 'invokeLightweight called')

  const config = getLlmConfig(userId)
  if (typeof config === 'string') return config

  const smallModel = getConfig(userId, 'small_model')
  const modelId = smallModel ?? config.mainModel

  const model = createOpenAICompatible({ name: 'openai-compatible', ...config })(modelId)
  const timezone = getConfig(userId, 'timezone') ?? 'UTC'
  const systemPrompt = buildMinimalSystemPrompt(type, timezone)

  const messages: ModelMessage[] = [...buildMetadataMessages(metadata), { role: 'user', content: wrapPrompt(prompt) }]

  log.debug({ userId, modelId, mode: 'lightweight' }, 'Calling generateText')
  const result = await generateText({ model, system: systemPrompt, messages })

  const assistantMessages = result.response.messages
  if (assistantMessages.length > 0) {
    appendHistory(userId, assistantMessages)
    log.debug({ userId, count: assistantMessages.length }, 'Lightweight response appended to history')
  }

  return result.text ?? 'Done.'
}
```

**Step 4: Implement `invokeWithContext`**

```typescript
async function invokeWithContext(
  userId: string,
  type: 'scheduled' | 'alert',
  prompt: string,
  metadata: ExecutionMetadata,
): Promise<string> {
  log.debug({ userId, mode: 'context' }, 'invokeWithContext called')

  const config = getLlmConfig(userId)
  if (typeof config === 'string') return config

  const model = createOpenAICompatible({ name: 'openai-compatible', ...config })(config.mainModel)
  const timezone = getConfig(userId, 'timezone') ?? 'UTC'
  const systemPrompt = buildMinimalSystemPrompt(type, timezone)

  const history = getCachedHistory(userId)
  const { messages: messagesWithMemory } = buildMessagesWithMemory(userId, history)
  const messages: ModelMessage[] = [
    ...messagesWithMemory,
    ...buildMetadataMessages(metadata),
    { role: 'user', content: wrapPrompt(prompt) },
  ]

  log.debug(
    { userId, mainModel: config.mainModel, historyLength: history.length, mode: 'context' },
    'Calling generateText',
  )
  const result = await generateText({ model, system: systemPrompt, messages })

  const assistantMessages = result.response.messages
  if (assistantMessages.length > 0) {
    appendHistory(userId, assistantMessages)
    log.debug({ userId, count: assistantMessages.length }, 'Context response appended to history')

    const updatedHistory = [...history, ...assistantMessages]
    if (shouldTriggerTrim(updatedHistory)) {
      void runTrimInBackground(userId, updatedHistory)
    }
  }

  return result.text ?? 'Done.'
}
```

**Step 5: Refactor `invokeLlmWithHistory` into `invokeFull`**

Rename `invokeLlmWithHistory` to `invokeFull` and add delivery brief + context snapshot injection:

```typescript
async function invokeFull(
  userId: string,
  type: 'scheduled' | 'alert',
  prompt: string,
  metadata: ExecutionMetadata,
  buildProviderFn: BuildProviderFn,
  matchedTasksSummary?: string,
): Promise<string> {
  log.debug({ userId, mode: 'full' }, 'invokeFull called')

  const config = getLlmConfig(userId)
  if (typeof config === 'string') return config

  const provider = buildProviderFn(userId)
  if (provider === null) {
    log.warn({ userId }, 'Could not build task provider for deferred prompt')
    return 'Deferred prompt skipped: task provider not configured.'
  }

  const model = createOpenAICompatible({ name: 'openai-compatible', ...config })(config.mainModel)
  const tools = makeTools(provider, userId, 'proactive')
  const timezone = getConfig(userId, 'timezone') ?? 'UTC'
  const systemPrompt = buildSystemPrompt(provider, timezone, userId)

  const trigger = buildProactiveTrigger(type, prompt, timezone, matchedTasksSummary)

  const history = getCachedHistory(userId)
  const { messages: messagesWithMemory } = buildMessagesWithMemory(userId, history)
  const finalMessages: ModelMessage[] = [
    ...messagesWithMemory,
    { role: 'system', content: trigger.systemContext },
    ...buildMetadataMessages(metadata),
    { role: 'user', content: trigger.userContent },
  ]

  log.debug(
    { userId, mainModel: config.mainModel, historyLength: history.length, mode: 'full' },
    'Calling generateText',
  )
  const result = await generateText({
    model,
    system: systemPrompt,
    messages: finalMessages,
    tools,
    stopWhen: stepCountIs(25),
  })

  persistProactiveResults(userId, result, history)
  return result.text ?? 'Done.'
}
```

**Step 6: Implement the dispatcher**

```typescript
export async function dispatchExecution(
  userId: string,
  type: 'scheduled' | 'alert',
  prompt: string,
  metadata: ExecutionMetadata,
  buildProviderFn: BuildProviderFn,
  matchedTasksSummary?: string,
): Promise<string> {
  log.debug({ userId, mode: metadata.mode }, 'dispatchExecution called')

  switch (metadata.mode) {
    case 'lightweight':
      return invokeLightweight(userId, type, prompt, metadata)
    case 'context':
      return invokeWithContext(userId, type, prompt, metadata)
    case 'full':
      return invokeFull(userId, type, prompt, metadata, buildProviderFn, matchedTasksSummary)
  }
}
```

**Step 7: Keep `invokeLlmWithHistory` as a backward-compatible wrapper**

For any callers that still use it (poller.ts), keep a thin wrapper until the poller is updated in Task 9:

```typescript
export async function invokeLlmWithHistory(
  userId: string,
  trigger: ProactiveTrigger,
  buildProviderFn: BuildProviderFn,
): Promise<string> {
  return invokeFull(userId, 'scheduled', trigger.userContent, DEFAULT_EXECUTION_METADATA, buildProviderFn)
}
```

**Step 8: Run the tests**

Run: `bun test tests/deferred-prompts/execution-modes.test.ts`
Expected: PASS

Run: `bun test tests/deferred-prompts/`
Expected: PASS — all existing tests still pass because `invokeLlmWithHistory` is preserved.

**Step 9: Commit**

```bash
git add src/deferred-prompts/proactive-llm.ts
git commit -m "feat(deferred): implement three execution functions and dispatcher"
```

---

### Task 9: Update Poller to Use Dispatcher

**Files:**

- Modify: `src/deferred-prompts/poller.ts`

**Step 1: Update imports**

Replace:

```typescript
import {
  buildProactiveTrigger,
  invokeLlmWithHistory,
  type BuildProviderFn,
  type ProactiveTrigger,
} from './proactive-llm.js'
```

With:

```typescript
import { dispatchExecution, type BuildProviderFn } from './proactive-llm.js'
```

**Step 2: Update `executeScheduledPromptsForUser`**

Replace the `buildMergedTrigger` + `invokeLlmWithHistory` call with the dispatcher:

```typescript
async function executeScheduledPromptsForUser(
  userId: string,
  prompts: ScheduledPrompt[],
  chat: ChatProvider,
  buildProviderFn: BuildProviderFn,
): Promise<void> {
  const timezone = getConfig(userId, 'timezone') ?? 'UTC'
  const promptIds = prompts.map((p) => p.id)

  log.debug({ userId, promptCount: prompts.length, promptIds }, 'Executing merged scheduled prompts')

  // For merged prompts, use first prompt's metadata (or merge into combined prompt)
  const combinedPrompt =
    prompts.length === 1 ? prompts[0]!.prompt : prompts.map((p, i) => `${String(i + 1)}. "${p.prompt}"`).join('\n')

  // Use first prompt's execution metadata; merged prompts fall back to full mode
  const metadata =
    prompts.length === 1
      ? prompts[0]!.executionMetadata
      : { mode: 'full' as const, delivery_brief: '', context_snapshot: null }

  let response: string
  try {
    response = await dispatchExecution(userId, 'scheduled', combinedPrompt, metadata, buildProviderFn)
    await chat.sendMessage(userId, response)
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    log.error({ userId, promptIds, error: errMsg }, 'Scheduled prompt LLM invocation failed')
    response = `Failed: ${errMsg}`
    await chat.sendMessage(userId, `I ran into an error while working on that: ${errMsg}`)
  }

  finalizeAllPrompts(prompts, new Date().toISOString(), timezone)
}
```

**Step 3: Update `executeSingleAlert`**

Replace the `buildProactiveTrigger` + `invokeLlmWithHistory` call:

```typescript
async function executeSingleAlert(
  alert: ReturnType<typeof getEligibleAlertPrompts>[number],
  userId: string,
  tasks: Task[],
  snapshots: Map<string, string>,
  chat: ChatProvider,
  buildProviderFn: BuildProviderFn,
  evalNow: Date,
): Promise<void> {
  const matchedTasks = tasks.filter((task) => evaluateCondition(alert.condition, task, snapshots, evalNow))
  if (matchedTasks.length === 0) return

  const conditionDesc = describeCondition(alert.condition)
  const taskList = matchedTasks.map((t) => `- [${t.title}](${t.url})${formatTaskStatus(t.status)}`).join('\n')
  const matchedTasksSummary = `Alert condition: ${conditionDesc}\n${taskList}`

  let response: string
  try {
    response = await dispatchExecution(
      userId,
      'alert',
      alert.prompt,
      alert.executionMetadata,
      buildProviderFn,
      matchedTasksSummary,
    )
    await chat.sendMessage(userId, response)
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    log.error({ id: alert.id, userId, error: errMsg }, 'Alert prompt LLM invocation failed')
    response = `Failed: ${errMsg}`
    await chat.sendMessage(userId, `Sorry, something went wrong while preparing this update: ${errMsg}`)
  }

  const now = new Date().toISOString()
  updateAlertTriggerTime(alert.id, userId, now)
  log.info({ id: alert.id, userId, matchedCount: matchedTasks.length }, 'Alert triggered')
}
```

**Step 4: Remove `buildMergedTrigger` function**

It's no longer needed — the merging logic is inline in `executeScheduledPromptsForUser`.

**Step 5: Remove unused imports**

Remove `type ProactiveTrigger` and `buildProactiveTrigger` from the import if they are no longer used. Remove the `import type { Task }` if it's only used in the alert function which now uses `evaluateCondition` directly.

**Step 6: Run tests**

Run: `bun test tests/deferred-prompts/poller.test.ts`
Expected: PASS

Run: `bun test tests/deferred-prompts/`
Expected: PASS

**Step 7: Run full check**

Run: `bun typecheck && bun test`
Expected: PASS

**Step 8: Commit**

```bash
git add src/deferred-prompts/poller.ts
git commit -m "feat(poller): use dispatchExecution instead of invokeLlmWithHistory"
```

---

### Task 10: Clean Up — Remove Backward Compatibility Wrapper

**Files:**

- Modify: `src/deferred-prompts/proactive-llm.ts`

**Step 1: Check for remaining callers of `invokeLlmWithHistory`**

Run: `grep -r "invokeLlmWithHistory" src/ tests/ --include="*.ts" -l`

If the only references are the definition and possibly old test files, remove the wrapper.

**Step 2: Remove the wrapper function**

Delete the `invokeLlmWithHistory` export wrapper added in Task 8. Update the export to only expose `dispatchExecution`, `buildProactiveTrigger`, `BuildProviderFn`, and `ProactiveTrigger`.

**Step 3: Update any remaining test imports**

If `tests/deferred-prompts/poller.test.ts` or other tests still import `invokeLlmWithHistory`, update them to use `dispatchExecution`.

**Step 4: Run full suite**

Run: `bun typecheck && bun test`
Expected: PASS

**Step 5: Run full check**

Run: `bun check:verbose`
Expected: PASS

**Step 6: Commit**

```bash
git add src/deferred-prompts/proactive-llm.ts tests/
git commit -m "refactor(deferred): remove invokeLlmWithHistory backward compat wrapper"
```

---

### Task 11: Add Tool Tests for `execution` Parameter

**Files:**

- Modify: `tests/deferred-prompts/tools.test.ts`

**Step 1: Add tests for create with execution metadata**

Add to the `create_deferred_prompt` describe block:

```typescript
test('creates with execution metadata', async () => {
  const t = getTools()['create_deferred_prompt']!
  if (!t.execute) throw new Error('Tool execute is undefined')
  const result: unknown = await t.execute(
    {
      prompt: 'Drink water',
      schedule: { fire_at: futureFireAt() },
      execution: {
        mode: 'lightweight',
        delivery_brief: 'Simple hydration reminder',
      },
    },
    toolCtx,
  )
  expect(result).toHaveProperty('status', 'created')
})

test('creates without execution metadata (backward compat)', async () => {
  const t = getTools()['create_deferred_prompt']!
  if (!t.execute) throw new Error('Tool execute is undefined')
  const result: unknown = await t.execute({ prompt: 'Remind me', schedule: { fire_at: futureFireAt() } }, toolCtx)
  expect(result).toHaveProperty('status', 'created')
})

test('persists execution metadata in scheduled prompt', async () => {
  const t = getTools()['create_deferred_prompt']!
  if (!t.execute) throw new Error('Tool execute is undefined')
  const result: unknown = await t.execute(
    {
      prompt: 'Check tasks',
      schedule: { fire_at: futureFireAt() },
      execution: {
        mode: 'context',
        delivery_brief: 'Remind about standup',
        context_snapshot: 'Sprint planning discussion',
      },
    },
    toolCtx,
  )
  const id = extractId(result)

  const getTool = getTools()['get_deferred_prompt']!
  if (!getTool.execute) throw new Error('Tool execute is undefined')
  const detail: unknown = await getTool.execute({ id }, toolCtx)
  expect(detail).toHaveProperty('executionMetadata')
  const meta = Reflect.get(detail as object, 'executionMetadata') as {
    mode: string
    delivery_brief: string
    context_snapshot: string | null
  }
  expect(meta.mode).toBe('context')
  expect(meta.delivery_brief).toBe('Remind about standup')
  expect(meta.context_snapshot).toBe('Sprint planning discussion')
})
```

**Step 2: Add tests for update with execution metadata**

```typescript
test('updates execution metadata on scheduled prompt', async () => {
  const tools = getTools()
  const createTool = tools['create_deferred_prompt']!
  if (!createTool.execute) throw new Error('Tool execute is undefined')
  const created: unknown = await createTool.execute({ prompt: 'Test', schedule: { fire_at: futureFireAt() } }, toolCtx)
  const id = extractId(created)

  const updateTool = tools['update_deferred_prompt']!
  if (!updateTool.execute) throw new Error('Tool execute is undefined')
  const result: unknown = await updateTool.execute(
    { id, execution: { mode: 'full', delivery_brief: 'Updated brief' } },
    toolCtx,
  )
  expect(result).toHaveProperty('status', 'updated')
})
```

**Step 3: Run tests**

Run: `bun test tests/deferred-prompts/tools.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add tests/deferred-prompts/tools.test.ts
git commit -m "test(tools): add tests for execution parameter on deferred prompt tools"
```

---

### Task 12: Final Verification

**Files:** None (verification only)

**Step 1: Run full test suite**

Run: `bun test`
Expected: PASS

**Step 2: Run full checks**

Run: `bun check:verbose`
Expected: PASS

**Step 3: Run knip for dead code**

Run: `bun knip`
Expected: No new unused exports. If `invokeLlmWithHistory` or `buildMergedTrigger` show up, they were successfully removed.

**Step 4: Commit if any cleanup was needed**

```bash
git add -A
git commit -m "chore: final cleanup for execution modes"
```
