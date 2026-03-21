# DDD Refactoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Increase Domain-Driven Design compliance by introducing a branded `UserId` type, extracting an `LlmOrchestrator` domain service from the Telegram adapter, and replacing hardcoded fact extraction with a registry pattern.

**Architecture:** Three independent, additive changes that do not depend on each other. `UserId` removes primitive obsession throughout. `LlmOrchestrator` decouples business logic from the Grammy `ctx: Context` Telegram adapter, enabling testing without a bot connection. `FactExtractorRegistry` replaces an imperative if-chain with a declarative map, making it trivial to add new tools.

**Tech Stack:** Bun, TypeScript (strict), `bun:test`, pino structured logging, Zod v4, Vercel AI SDK (`ai`, `@ai-sdk/openai-compatible`), Grammy, bun:sqlite.

---

## Task 1: Introduce `UserId` branded type

### Files

- Create: `src/domain/ids.ts`
- Modify: `src/users.ts`
- Modify: `src/config.ts`
- Modify: `src/history.ts`
- Modify: `src/memory.ts`
- Modify: `src/conversation.ts`
- Modify: `src/bot.ts`
- Modify: `src/commands/admin.ts`
- Modify: `tests/config.test.ts`

### Step 1: Write the failing test

Add to `tests/config.test.ts` — insert after the imports section, before the `const USER_A = 111` line:

```typescript
import { toUserId } from '../src/domain/ids.js'
```

Then replace:

```typescript
const USER_A = 111
const USER_B = 222
```

with:

```typescript
const USER_A = toUserId(111)
const USER_B = toUserId(222)
```

### Step 2: Run test to verify it fails

```bash
bun test tests/config.test.ts
```

Expected: FAIL with `Cannot find module '../src/domain/ids.js'`

### Step 3: Create `src/domain/ids.ts`

```typescript
/**
 * Branded type for Telegram user IDs.
 * Prevents raw numbers from being passed where a user identity is expected.
 */
export type UserId = number & { readonly __brand: 'UserId' }

export function toUserId(id: number): UserId {
  return id as UserId
}
```

### Step 4: Run test to verify it passes

```bash
bun test tests/config.test.ts
```

Expected: All tests PASS.

### Step 5: Update `src/config.ts` — replace `userId: number` with `userId: UserId`

Add import at the top:

```typescript
import type { UserId } from './domain/ids.js'
```

Replace the three function signatures:

```typescript
// Before
export function setConfig(userId: number, key: ConfigKey, value: string): void {
// After
export function setConfig(userId: UserId, key: ConfigKey, value: string): void {

// Before
export function getConfig(userId: number, key: ConfigKey): string | null {
// After
export function getConfig(userId: UserId, key: ConfigKey): string | null {

// Before
export function getAllConfig(userId: number): Partial<Record<ConfigKey, string>> {
// After
export function getAllConfig(userId: UserId): Partial<Record<ConfigKey, string>> {
```

### Step 6: Update `src/users.ts` — replace `telegramId: number` with `telegramId: UserId`

Add import at the top:

```typescript
import type { UserId } from './domain/ids.js'
```

Update `UserRecord`:

```typescript
export interface UserRecord {
  telegram_id: UserId
  username: string | null
  added_at: string
  added_by: UserId
}
```

Update all function signatures that accept a telegram user ID:

```typescript
export function addUser(telegramId: UserId, addedBy: UserId, username?: string): void {
export function removeUser(identifier: UserId | string): void {
export function isAuthorized(telegramId: UserId): boolean {
export function isAuthorizedByUsername(username: string): boolean {  // no change
export function resolveUserByUsername(telegramId: UserId, username: string): boolean {
export function getKaneoWorkspace(telegramId: UserId): string | null {
export function setKaneoWorkspace(telegramId: UserId, workspaceId: string): void {
```

### Step 7: Update `src/history.ts`

Add import:

```typescript
import type { UserId } from './domain/ids.js'
```

Replace signatures:

```typescript
export function loadHistory(userId: UserId): readonly ModelMessage[] {
export function saveHistory(userId: UserId, messages: readonly ModelMessage[]): void {
export function clearHistory(userId: UserId): void {
```

### Step 8: Update `src/memory.ts`

Add import:

```typescript
import type { UserId } from './domain/ids.js'
```

Replace all `userId: number` parameter types with `userId: UserId` in these functions:

- `loadSummary(userId: UserId)`
- `saveSummary(userId: UserId, summary: string)`
- `clearSummary(userId: UserId)`
- `loadFacts(userId: UserId)`
- `upsertFact(userId: UserId, fact: Omit<MemoryFact, 'last_seen'>)`
- `clearFacts(userId: UserId)`

### Step 9: Update `src/conversation.ts`

Add import:

```typescript
import type { UserId } from './domain/ids.js'
```

Replace signatures:

```typescript
export const buildMessagesWithMemory = (userId: UserId, history: readonly ModelMessage[]): MessagesWithMemory => {
export const trimAndSummarise = async (
  history: readonly ModelMessage[],
  userId: UserId,
): Promise<readonly ModelMessage[]> => {
```

### Step 10: Update `src/bot.ts` — wrap raw IDs at the Telegram boundary

Add import:

```typescript
import { toUserId } from './domain/ids.js'
```

In `checkAuthorization`:

```typescript
const checkAuthorization = (userId: number | undefined, username?: string): userId is number => {
  log.debug({ userId }, 'Checking authorization')
  if (userId === undefined) return false
  if (isAuthorized(toUserId(userId))) return true
  if (username !== undefined && resolveUserByUsername(toUserId(userId), username)) return true
  log.warn({ attemptedUserId: userId }, 'Unauthorized access attempt')
  return false
}
```

In `bot.on('message:text', ...)` handler, wrap before use:

```typescript
bot.on('message:text', async (ctx) => {
  const rawUserId = ctx.from?.id
  if (!checkAuthorization(rawUserId, ctx.from?.username)) {
    return
  }
  const userId = toUserId(rawUserId!)
  const userText = ctx.message.text
  await processMessage(ctx, userId, userText)
})
```

Update `getOrCreateHistory`, `callLlm`, `processMessage`, `maybeProvisionKaneo`, `buildKaneoConfig`, `sendLlmResponse`, `persistFactsFromResults` to accept `UserId` instead of `number`. Also update `adminUserId`:

```typescript
const adminUserId = toUserId(parseInt(process.env['TELEGRAM_USER_ID']!, 10))
```

### Step 11: Update `src/commands/admin.ts`

Add import and wrap raw IDs in admin command handlers with `toUserId()` when reading from Telegram context or env var.

### Step 12: Run all tests

```bash
bun test
```

Expected: All tests PASS (TypeScript errors would surface at compile time too).

### Step 13: Run lint

```bash
bun run lint
```

Expected: No errors.

### Step 14: Commit

```bash
git add src/domain/ids.ts src/config.ts src/users.ts src/history.ts src/memory.ts src/conversation.ts src/bot.ts src/commands/admin.ts tests/config.test.ts
git commit -m "feat: introduce UserId branded type to eliminate primitive obsession"
```

---

## Task 2: Extract `LlmOrchestrator` domain service from `bot.ts`

### Files

- Create: `src/llm-orchestrator.ts`
- Create: `tests/llm-orchestrator.test.ts`
- Modify: `src/bot.ts`

### Step 1: Write the failing test

Create `tests/llm-orchestrator.test.ts`:

```typescript
import { mock, describe, expect, test, spyOn } from 'bun:test'
import type { ModelMessage } from 'ai'

// Mock db before importing modules that use it
const store = { data: new Map<string, string>() }
class MockDatabase {
  run(): void {}
  query() {
    return { get: (): null => null, all: (): [] => [] }
  }
}
void mock.module('../src/db/index.js', () => ({
  getDb: () => new MockDatabase(),
  DB_PATH: ':memory:',
  initDb: (): void => {},
}))

// Mock generateText from ai
void mock.module('ai', () => ({
  generateText: async () => ({
    text: 'Task created.',
    toolCalls: [],
    toolResults: [],
    response: { messages: [] as ModelMessage[] },
    usage: {},
  }),
  stepCountIs: () => () => false,
  Output: { object: () => ({}) },
}))

// Mock openai-compatible
void mock.module('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: () => () => ({}),
}))

import { orchestrate } from '../src/llm-orchestrator.js'
import { toUserId } from '../src/domain/ids.js'

const USER_ID = toUserId(42)
const WORKSPACE_ID = 'ws-001'

describe('orchestrate', () => {
  test('returns text result on success', async () => {
    const history: ModelMessage[] = [{ role: 'user', content: 'create a task' }]
    const result = await orchestrate({
      userId: USER_ID,
      history,
      llmConfig: { apiKey: 'test-key', baseUrl: 'http://localhost', model: 'gpt-4o' },
      kaneoConfig: { apiKey: 'kaneo-key', baseUrl: 'http://kaneo' },
      workspaceId: WORKSPACE_ID,
    })
    expect(result.type).toBe('success')
    if (result.type === 'success') {
      expect(result.text).toBe('Task created.')
      expect(result.updatedHistory).toBeArray()
    }
  })

  test('returns missing_config when llmConfig is null', async () => {
    const result = await orchestrate({
      userId: USER_ID,
      history: [],
      llmConfig: null,
      kaneoConfig: { apiKey: 'k', baseUrl: 'http://kaneo' },
      workspaceId: WORKSPACE_ID,
    })
    expect(result.type).toBe('missing_config')
  })
})
```

### Step 2: Run test to verify it fails

```bash
bun test tests/llm-orchestrator.test.ts
```

Expected: FAIL with `Cannot find module '../src/llm-orchestrator.js'`

### Step 3: Create `src/llm-orchestrator.ts`

Extract the pure orchestration logic out of `bot.ts`:

```typescript
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, stepCountIs } from 'ai'
import type { ModelMessage } from 'ai'

import type { UserId } from './domain/ids.js'
import type { KaneoConfig } from './kaneo/client.js'
import { buildMessagesWithMemory } from './conversation.js'
import { extractFactsFromSdkResults, upsertFact } from './memory.js'
import { makeTools } from './tools/index.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'llm-orchestrator' })

const SYSTEM_PROMPT = `You are papai, a personal assistant that helps the user manage their Kaneo tasks directly from Telegram.
Current date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.
You can:
- Create new tasks with titles, descriptions, priorities, and project associations
- Update task statuses, priorities, and assignees
- Search for tasks by keyword
- List all tasks in a project
- List available projects and status columns
- Fetch full details of a specific task
- Add and read comments on tasks
- Create labels, list available labels; apply or remove labels on tasks
- Set due dates on tasks
- Create and read task relations (blocks, duplicate, related) stored as frontmatter in descriptions
- Create and manage projects
- Archive tasks by applying an "archived" label
- Manage kanban board columns: create, update, delete, and reorder columns in projects

IMPORTANT: Task Status vs Kanban Board Columns
- Columns represent the kanban board structure (e.g., "Todo", "In Progress", "Done") - they define how tasks are organized visually
- Task status is which column a task currently belongs to - it's the column name stored on the task itself
- To move a task to a different column, update its status field with the column name
- To change the board layout itself (add/remove/rename/reorder columns), use the column management tools
- Use list_columns to see available columns before updating a task status

Always confirm actions to the user in a friendly, concise manner. \
When creating or updating tasks, summarize what was done and include the task ID if available. \
If you need context (like project IDs), call list_projects first. \
To see available status columns for a project, call list_columns.`

export type LlmConfig = {
  readonly apiKey: string
  readonly baseUrl: string
  readonly model: string
}

export type OrchestratorInput = {
  readonly userId: UserId
  readonly history: readonly ModelMessage[]
  readonly llmConfig: LlmConfig | null
  readonly kaneoConfig: KaneoConfig
  readonly workspaceId: string
}

export type OrchestratorResult =
  | { readonly type: 'success'; readonly text: string; readonly updatedHistory: readonly ModelMessage[] }
  | { readonly type: 'missing_config' }
  | { readonly type: 'error'; readonly error: unknown }

export async function orchestrate(input: OrchestratorInput): Promise<OrchestratorResult> {
  const { userId, history, llmConfig, kaneoConfig, workspaceId } = input

  if (llmConfig === null) {
    log.warn({ userId }, 'orchestrate called with null llmConfig')
    return { type: 'missing_config' }
  }

  log.debug({ userId, historyLength: history.length }, 'orchestrate called')

  try {
    const openai = createOpenAICompatible({
      name: 'openai-compatible',
      apiKey: llmConfig.apiKey,
      baseURL: llmConfig.baseUrl,
    })
    const model = openai(llmConfig.model)
    const tools = makeTools({ kaneoConfig, workspaceId })
    const { messages: messagesWithMemory } = buildMessagesWithMemory(userId, history)

    const result = await generateText({
      model,
      system: SYSTEM_PROMPT,
      messages: messagesWithMemory,
      tools,
      stopWhen: stepCountIs(25),
    })

    log.debug({ userId, toolCalls: result.toolCalls?.length, usage: result.usage }, 'LLM response received')

    const newFacts = extractFactsFromSdkResults(result.toolCalls, result.toolResults)
    for (const fact of newFacts) upsertFact(userId, fact)
    if (newFacts.length > 0) {
      log.info({ userId, factsExtracted: newFacts.length }, 'Facts extracted and persisted')
    }

    const text = result.text !== undefined && result.text !== '' ? result.text : 'Done.'
    const updatedHistory: readonly ModelMessage[] = [...history, ...result.response.messages]

    log.info(
      { userId, responseLength: text.length, toolCalls: result.toolCalls?.length ?? 0 },
      'Orchestration complete',
    )
    return { type: 'success', text, updatedHistory }
  } catch (error) {
    log.error({ userId, error: error instanceof Error ? error.message : String(error) }, 'orchestrate failed')
    return { type: 'error', error }
  }
}
```

### Step 4: Run test to verify it passes

```bash
bun test tests/llm-orchestrator.test.ts
```

Expected: All tests PASS.

### Step 5: Update `bot.ts` to use `orchestrate`

Remove the `callLlm` function and replace with a thin delegation to `orchestrate`. Also remove the `SYSTEM_PROMPT` constant (it now lives in `llm-orchestrator.ts`) and the `persistFactsFromResults` helper (moved into `orchestrate`).

```typescript
import { orchestrate } from './llm-orchestrator.js'
import { formatLlmOutput } from './utils/format.js'
```

Replace the `callLlm` function body:

```typescript
const callLlm = async (ctx: Context, userId: UserId, history: readonly ModelMessage[]): Promise<void> => {
  await maybeProvisionKaneo(ctx, userId)

  const llmApiKey = getConfig(userId, 'llm_apikey')
  const llmBaseUrl = getConfig(userId, 'llm_baseurl')
  const mainModel = getConfig(userId, 'main_model')
  const kaneoWorkspaceId = getKaneoWorkspace(userId)

  const llmConfig =
    llmApiKey !== null && llmBaseUrl !== null && mainModel !== null
      ? { apiKey: llmApiKey, baseUrl: llmBaseUrl, model: mainModel }
      : null

  if (kaneoWorkspaceId === null) {
    log.warn({ userId }, 'No Kaneo workspace ID — cannot call LLM')
    await ctx.reply('Missing configuration: kaneo workspace.\nUse /set kaneo_apikey <value> to configure.')
    return
  }

  const kaneoConfig = buildKaneoConfig(userId)
  const result = await withTypingIndicator(ctx, () =>
    orchestrate({ userId, history, llmConfig, kaneoConfig, workspaceId: kaneoWorkspaceId }),
  )

  if (result.type === 'missing_config') {
    const missing = checkRequiredConfig(userId)
    log.warn({ userId, missing }, 'Missing required config keys')
    await ctx.reply(`Missing configuration: ${missing.join(', ')}.\nUse /set <key> <value> to configure.`)
    return
  }

  if (result.type === 'error') {
    throw result.error
  }

  const formatted = formatLlmOutput(result.text)
  saveHistory(userId, result.updatedHistory)
  await ctx.reply(formatted.text, { entities: formatted.entities })
  log.info({ userId, responseLength: result.text.length }, 'Response sent successfully')
}
```

Remove `sendLlmResponse` (inlined above) and `persistFactsFromResults` (moved to `llm-orchestrator.ts`) from `bot.ts`.

### Step 6: Run all tests

```bash
bun test
```

Expected: All tests PASS.

### Step 7: Run lint

```bash
bun run lint
```

Expected: No errors.

### Step 8: Commit

```bash
git add src/llm-orchestrator.ts tests/llm-orchestrator.test.ts src/bot.ts
git commit -m "feat: extract LlmOrchestrator domain service, decouple orchestration from Telegram adapter"
```

---

## Task 3: Replace hardcoded fact extraction with `FactExtractorRegistry`

### Files

- Modify: `src/memory.ts`
- Modify: `tests/memory.test.ts` (or create if not present)

### Step 1: Read the existing test to understand what to test

Check `tests/memory.test.ts` — it already tests `extractFacts`. The registry refactor is purely internal; the public API (`extractFacts`, `extractFactsFromSdkResults`) must not change. Add one test to verify new tools can be registered:

```typescript
// At the end of the extractFacts describe block in tests/memory.test.ts:
test('unknown tools produce no facts', () => {
  const results = extractFacts([], [{ toolName: 'some_future_tool', result: { id: 'x', title: 'y' } }])
  expect(results).toHaveLength(0)
})
```

### Step 2: Run test to verify it passes (it already passes — confirms baseline)

```bash
bun test tests/memory.test.ts
```

Expected: All existing tests PASS, including the new one.

### Step 3: Refactor `extractFacts` in `src/memory.ts` to use a registry

Replace lines 101–162 (the `ToolCallEntry`, `ToolResultEntry` types, schemas, and `extractFacts` function) with:

```typescript
// --- Rule-based fact extraction (registry pattern) ---

type ToolCallEntry = { toolName: string; args: unknown }
type ToolResultEntry = { toolName: string; result: unknown }

export type FactExtractor = (result: unknown) => readonly Omit<MemoryFact, 'last_seen'>[]

const TaskResultSchema = z.looseObject({
  id: z.string(),
  title: z.string().optional(),
  number: z.number().optional(),
})

const ProjectResultSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  url: z.string().optional(),
})

function taskExtractor(result: unknown): readonly Omit<MemoryFact, 'last_seen'>[] {
  const parsed = TaskResultSchema.safeParse(result)
  if (!parsed.success) return []
  const label = parsed.data.number === undefined ? parsed.data.id : `#${parsed.data.number}`
  return [{ identifier: label, title: parsed.data.title ?? label, url: '' }]
}

function searchTasksExtractor(result: unknown): readonly Omit<MemoryFact, 'last_seen'>[] {
  const items = z.array(TaskResultSchema).safeParse(result)
  if (!items.success) return []
  return items.data.slice(0, 3).map((item) => {
    const label = item.number === undefined ? item.id : `#${item.number}`
    return { identifier: label, title: item.title ?? label, url: '' }
  })
}

function createProjectExtractor(result: unknown): readonly Omit<MemoryFact, 'last_seen'>[] {
  const parsed = ProjectResultSchema.safeParse(result)
  if (!parsed.success) return []
  return [{ identifier: `proj:${parsed.data.id}`, title: parsed.data.name, url: parsed.data.url ?? '' }]
}

const FACT_EXTRACTORS: Readonly<Record<string, FactExtractor>> = {
  create_task: taskExtractor,
  update_task: taskExtractor,
  get_task: taskExtractor,
  search_tasks: searchTasksExtractor,
  create_project: createProjectExtractor,
}

export function extractFacts(
  _toolCalls: readonly ToolCallEntry[],
  toolResults: readonly ToolResultEntry[],
): readonly Omit<MemoryFact, 'last_seen'>[] {
  const facts: Omit<MemoryFact, 'last_seen'>[] = []
  for (const result of toolResults) {
    const extractor = FACT_EXTRACTORS[result.toolName]
    if (extractor !== undefined) {
      facts.push(...extractor(result.result))
    }
  }
  return facts
}
```

### Step 4: Run tests to verify behaviour is unchanged

```bash
bun test tests/memory.test.ts
```

Expected: All tests PASS.

### Step 5: Run all tests

```bash
bun test
```

Expected: All tests PASS.

### Step 6: Run lint

```bash
bun run lint
```

Expected: No errors.

### Step 7: Commit

```bash
git add src/memory.ts tests/memory.test.ts
git commit -m "refactor: replace hardcoded fact extraction if-chain with FactExtractorRegistry"
```

---

## Summary

| Task                       | Scope                                    | DDD Pattern                                                                                   |
| -------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1. `UserId` branded type   | `src/domain/ids.ts` + 6 files            | Eliminates primitive obsession; enforces identity semantics at compile time                   |
| 2. `LlmOrchestrator`       | `src/llm-orchestrator.ts` + `src/bot.ts` | Separates domain logic from Telegram transport adapter; enables unit testing of orchestration |
| 3. `FactExtractorRegistry` | `src/memory.ts`                          | Open/closed principle — add a new tool extractor without modifying existing code              |
