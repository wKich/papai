# Layered Architecture Refactoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve architectural compliance by extracting LLM orchestration from the bot presentation layer and decoupling the memory module from the AI SDK infrastructure.

**Architecture:** Two targeted refactors: (1) move all LLM pipeline logic from `bot.ts` into a dedicated `llm-orchestrator.ts` module so `bot.ts` becomes a thin Grammy wiring layer; (2) change `trimWithMemoryModel` in `memory.ts` to accept a pre-built model instance instead of constructing it internally, removing AI SDK infrastructure from the application/persistence layer.

**Tech Stack:** Bun, TypeScript, Grammy, Vercel AI SDK (`ai`, `@ai-sdk/openai-compatible`), pino, SQLite

---

## Background: Why these two tasks

From the architectural assessment:

| Issue                                                                              | Impact                                                                |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `bot.ts` contains 12+ private orchestration functions alongside Grammy wiring      | Growing complexity, hard to test orchestration logic in isolation     |
| `memory.ts` imports `@ai-sdk/openai-compatible` and calls `createOpenAICompatible` | Infrastructure (AI SDK) bleeds into the persistence/application layer |

Both fixes are purely organizational — no behavior changes, no new features.

---

## Task 1: Extract `LlmOrchestrator` module from `bot.ts`

**Files:**

- Create: `src/llm-orchestrator.ts`
- Modify: `src/bot.ts`
- Test: `tests/bot.test.ts` (verify existing tests still pass — no new test needed)

### What moves

All non-Grammy logic currently in `bot.ts` moves to `src/llm-orchestrator.ts`:

| Function                  | Current file | Destination           |
| ------------------------- | ------------ | --------------------- |
| `SYSTEM_PROMPT`           | `bot.ts:24`  | `llm-orchestrator.ts` |
| `buildOpenAI`             | `bot.ts:71`  | `llm-orchestrator.ts` |
| `checkRequiredConfig`     | `bot.ts:73`  | `llm-orchestrator.ts` |
| `buildKaneoConfig`        | `bot.ts:124` | `llm-orchestrator.ts` |
| `persistFactsFromResults` | `bot.ts:77`  | `llm-orchestrator.ts` |
| `withTypingIndicator`     | `bot.ts:87`  | `llm-orchestrator.ts` |
| `maybeProvisionKaneo`     | `bot.ts:99`  | `llm-orchestrator.ts` |
| `sendLlmResponse`         | `bot.ts:132` | `llm-orchestrator.ts` |
| `callLlm`                 | `bot.ts:148` | `llm-orchestrator.ts` |
| `processMessage`          | `bot.ts:178` | `llm-orchestrator.ts` |
| `getOrCreateHistory`      | `bot.ts:62`  | `llm-orchestrator.ts` |

`checkAuthorization` stays in `bot.ts` — it is defined once and passed as callback to all command registration functions.

### Step 1: Run current tests to establish baseline

```bash
bun test tests/bot.test.ts
```

Expected: all tests pass. Note the count so you can verify nothing regresses.

### Step 2: Create `src/llm-orchestrator.ts`

```typescript
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { APICallError } from '@ai-sdk/provider'
import { generateText, stepCountIs } from 'ai'
import { type ModelMessage } from 'ai'
import type { Context } from 'grammy'

import { getConfig, setConfig } from './config.js'
import { buildMessagesWithMemory, trimAndSummarise } from './conversation.js'
import { getUserMessage, isAppError } from './errors.js'
import { loadHistory, saveHistory } from './history.js'
import { logger } from './logger.js'
import { extractFactsFromSdkResults, upsertFact } from './memory.js'
import { makeTools } from './tools/index.js'
import { getKaneoWorkspace, setKaneoWorkspace } from './users.js'
import { formatLlmOutput } from './utils/format.js'

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

const getOrCreateHistory = (userId: number): readonly ModelMessage[] => {
  log.debug({ userId }, 'getOrCreateHistory called')
  const history = loadHistory(userId)
  log.debug({ userId, messageCount: history.length }, 'Conversation history loaded')
  if (history.length === 0) {
    log.info({ userId }, 'No existing conversation history')
  }
  return history
}

const buildOpenAI = (apiKey: string, baseURL: string): ReturnType<typeof createOpenAICompatible> =>
  createOpenAICompatible({ name: 'openai-compatible', apiKey, baseURL })

const checkRequiredConfig = (userId: number): string[] => {
  const requiredKeys = ['llm_apikey', 'llm_baseurl', 'main_model', 'kaneo_apikey'] as const
  return requiredKeys.filter((k) => getConfig(userId, k) === null)
}

const persistFactsFromResults = (
  userId: number,
  toolCalls: Array<{ toolName: string; input: unknown }>,
  toolResults: Array<{ toolName: string; output: unknown }>,
): void => {
  const newFacts = extractFactsFromSdkResults(toolCalls, toolResults)
  if (newFacts.length === 0) return
  for (const fact of newFacts) upsertFact(userId, fact)
  log.info({ userId, factsExtracted: newFacts.length, factsUpserted: newFacts.length }, 'Facts extracted and persisted')
}

const withTypingIndicator = async <T>(ctx: Context, fn: () => Promise<T>): Promise<T> => {
  const send = (): void => {
    ctx.replyWithChatAction('typing').catch(() => undefined)
  }
  send()
  const interval = setInterval(send, 4500)
  try {
    return await fn()
  } finally {
    clearInterval(interval)
  }
}

const maybeProvisionKaneo = async (ctx: Context, userId: number): Promise<void> => {
  if (getKaneoWorkspace(userId) !== null && getConfig(userId, 'kaneo_apikey') !== null) return
  const kaneoUrl = process.env['KANEO_CLIENT_URL']
  if (kaneoUrl === undefined) return
  try {
    const { provisionKaneoUser } = await import('./kaneo/provision.js')
    const kaneoInternalUrl = process.env['KANEO_INTERNAL_URL'] ?? kaneoUrl
    const prov = await provisionKaneoUser(kaneoInternalUrl, kaneoUrl, userId, ctx.from?.username ?? null)
    setConfig(userId, 'kaneo_apikey', prov.kaneoKey)
    setKaneoWorkspace(userId, prov.workspaceId)
    log.info({ userId }, 'Kaneo account provisioned on first use')
    await ctx.reply(
      `✅ Your Kaneo account has been created!\n🌐 ${kaneoUrl}\n📧 Email: ${prov.email}\n🔑 Password: ${prov.password}\n\nThe bot is already configured and ready to use.`,
    )
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    const isRegistrationDisabled = msg.includes('sign-up') || msg.includes('registration') || msg.includes('Sign-up')
    log.warn({ userId, error: msg }, 'Kaneo auto-provisioning failed')
    if (isRegistrationDisabled) {
      await ctx.reply(
        'Kaneo account could not be created — registration is currently disabled on this instance.\n\nPlease ask the admin to provision your account.',
      )
    }
  }
}

const buildKaneoConfig = (userId: number): { apiKey: string; baseUrl: string; sessionCookie?: string } => {
  const kaneoKey = getConfig(userId, 'kaneo_apikey')!
  const kaneoBaseUrl = process.env['KANEO_CLIENT_URL']!
  const isSessionCookie = kaneoKey.startsWith('better-auth.session_token=')
  return isSessionCookie
    ? { apiKey: '', baseUrl: kaneoBaseUrl, sessionCookie: kaneoKey }
    : { apiKey: kaneoKey, baseUrl: kaneoBaseUrl }
}

const sendLlmResponse = async (
  ctx: Context,
  userId: number,
  history: readonly ModelMessage[],
  result: { text?: string; toolCalls?: unknown[]; response: { messages: ModelMessage[] } },
): Promise<void> => {
  const assistantText = result.text
  const textToFormat = assistantText !== undefined && assistantText !== '' ? assistantText : 'Done.'
  const formatted = formatLlmOutput(textToFormat)
  saveHistory(userId, [...history, ...result.response.messages])
  await ctx.reply(formatted.text, { entities: formatted.entities })
  log.info(
    { userId, responseLength: assistantText?.length ?? 0, toolCalls: result.toolCalls?.length ?? 0 },
    'Response sent successfully',
  )
}

const callLlm = async (ctx: Context, userId: number, history: readonly ModelMessage[]): Promise<void> => {
  await maybeProvisionKaneo(ctx, userId)
  const missing = checkRequiredConfig(userId)
  if (missing.length > 0) {
    log.warn({ userId, missing }, 'Missing required config keys')
    await ctx.reply(`Missing configuration: ${missing.join(', ')}.\nUse /set <key> <value> to configure.`)
    return
  }
  const llmApiKey = getConfig(userId, 'llm_apikey')!
  const llmBaseUrl = getConfig(userId, 'llm_baseurl')!
  const mainModel = getConfig(userId, 'main_model')!
  const kaneoWorkspaceId = getKaneoWorkspace(userId)!
  const model = buildOpenAI(llmApiKey, llmBaseUrl)(mainModel)
  const kaneoConfig = buildKaneoConfig(userId)
  const tools = makeTools({ kaneoConfig, workspaceId: kaneoWorkspaceId })
  const { messages: messagesWithMemory, memoryMsg } = buildMessagesWithMemory(userId, history)
  log.debug({ userId, historyLength: history.length, hasMemory: memoryMsg !== null }, 'Calling generateText')
  const result = await withTypingIndicator(ctx, () =>
    generateText({
      model,
      system: SYSTEM_PROMPT,
      messages: messagesWithMemory,
      tools,
      stopWhen: stepCountIs(25),
    }),
  )
  log.debug({ userId, toolCalls: result.toolCalls?.length, usage: result.usage }, 'LLM response received')
  persistFactsFromResults(userId, result.toolCalls, result.toolResults)
  await sendLlmResponse(ctx, userId, history, result)
}

export const processMessage = async (ctx: Context, userId: number, userText: string): Promise<void> => {
  log.debug({ userId, userText }, 'processMessage called')
  log.info({ userId, messageLength: userText.length }, 'Message received from user')
  const history = await trimAndSummarise([...getOrCreateHistory(userId), { role: 'user', content: userText }], userId)
  saveHistory(userId, history)
  try {
    await callLlm(ctx, userId, history)
  } catch (error) {
    saveHistory(userId, history.slice(0, -1))
    if (isAppError(error)) {
      const userMessage = getUserMessage(error)
      log.warn({ error: { type: error.type, code: error.code }, userId }, `Handled error: ${error.type}/${error.code}`)
      await ctx.reply(userMessage)
    } else if (APICallError.isInstance(error)) {
      log.error(
        {
          url: error.url,
          statusCode: error.statusCode,
          responseBody: error.responseBody,
          error: error.message,
          userId,
        },
        'LLM API call failed',
      )
      await ctx.reply('An unexpected error occurred. Please try again later.')
    } else {
      log.error(
        {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          userId,
        },
        'Unexpected error generating response',
      )
      await ctx.reply('An unexpected error occurred. Please try again later.')
    }
  }
}
```

### Step 3: Rewrite `src/bot.ts`

Replace the entire file with this slimmed-down version:

```typescript
import { Bot } from 'grammy'

import {
  registerAdminCommands,
  registerClearCommand,
  registerConfigCommand,
  registerHelpCommand,
  registerSetCommand,
} from './commands/index.js'
import { logger } from './logger.js'
import { processMessage } from './llm-orchestrator.js'
import { isAuthorized, resolveUserByUsername } from './users.js'

const log = logger.child({ scope: 'bot' })
const adminUserId = parseInt(process.env['TELEGRAM_USER_ID']!, 10)

export const bot = new Bot(process.env['TELEGRAM_BOT_TOKEN']!)

export const checkAuthorization = (userId: number | undefined, username?: string): userId is number => {
  log.debug({ userId }, 'Checking authorization')
  if (userId === undefined) return false
  if (isAuthorized(userId)) return true
  if (username !== undefined && resolveUserByUsername(userId, username)) return true
  log.warn({ attemptedUserId: userId }, 'Unauthorized access attempt')
  return false
}

registerHelpCommand(bot, checkAuthorization, adminUserId)
registerSetCommand(bot, checkAuthorization)
registerConfigCommand(bot, checkAuthorization)
registerClearCommand(bot, checkAuthorization, adminUserId)
registerAdminCommands(bot, adminUserId)

bot.on('message:text', async (ctx) => {
  const userId = ctx.from?.id
  if (!checkAuthorization(userId, ctx.from?.username)) {
    return
  }
  await processMessage(ctx, userId, ctx.message.text)
})
```

### Step 4: Run the tests

```bash
bun test tests/bot.test.ts
```

Expected: same pass count as Step 1 baseline. If any test imports symbols from `bot.ts` that moved (like `SYSTEM_PROMPT` or private functions), update those imports to point to `llm-orchestrator.ts`.

### Step 5: Run the full test suite

```bash
bun test
```

Expected: all existing tests pass with 0 failures.

### Step 6: Lint

```bash
bun run lint
```

Expected: no lint errors. Fix any unused import warnings (e.g., `APICallError` in `bot.ts` is now unused there).

### Step 7: Commit

```bash
git add src/llm-orchestrator.ts src/bot.ts
git commit -m "refactor: extract LlmOrchestrator module from bot.ts

Move all LLM pipeline logic (processMessage, callLlm, maybeProvisionKaneo,
buildKaneoConfig, sendLlmResponse, persistFactsFromResults, withTypingIndicator,
getOrCreateHistory, buildOpenAI, checkRequiredConfig) into src/llm-orchestrator.ts.

bot.ts is now a thin Grammy wiring layer: bot instance, checkAuthorization,
command registration, and the single message:text handler."
```

---

## Task 2: Decouple `memory.ts` from AI SDK

**Files:**

- Modify: `src/memory.ts`
- Modify: `src/conversation.ts`
- Modify: `tests/memory.test.ts`

**Context:** `memory.ts` currently imports `createOpenAICompatible` from `@ai-sdk/openai-compatible` and constructs a model instance inside `trimWithMemoryModel`. This means the persistence/application layer owns AI SDK infrastructure. The fix: accept a pre-built `LanguageModel` instead of a `ModelConfig`, and move model construction to `conversation.ts` (which already reads the config credentials).

### Step 1: Write the updated test first

In `tests/memory.test.ts`, the `trimWithMemoryModel` describe block currently passes a `ModelConfig` object:

```typescript
// Current (tests/memory.test.ts ~line 365):
const result = await trimWithMemoryModel(history, 2, 10, null, {
  apiKey: 'key',
  baseUrl: 'http://localhost',
  model: 'test-model',
})
```

Update **all four** `trimWithMemoryModel` test cases to pass a mock model instead. Since `generateText` is already mocked at the module level, the model instance is never actually called — pass an empty object cast to the right type:

```typescript
// Add this import at the top of the describe block or at file top
import type { LanguageModel } from 'ai'

// Use in each test:
const mockModel = {} as LanguageModel

// Replace all four calls:
const result = await trimWithMemoryModel(history, 2, 10, null, mockModel)
```

The four tests to update are at approximately lines 365, 383, 398, 414, 424 in `tests/memory.test.ts`. Each one currently ends with `{ apiKey: 'key', baseUrl: 'http://localhost', model: 'test-model' }` — replace that argument with `mockModel`.

### Step 2: Run the updated tests — expect failure

```bash
bun test tests/memory.test.ts --test-name-pattern "trimWithMemoryModel"
```

Expected: TypeScript type error or runtime mismatch because `trimWithMemoryModel` still expects `ModelConfig`. This confirms the test is driving the change.

### Step 3: Update `src/memory.ts`

**Remove:**

- The import of `createOpenAICompatible` from `@ai-sdk/openai-compatible`
- The `ModelConfig` type export
- The private `buildMemoryModel` function

**Add:**

- Import `type LanguageModel` from `'ai'`

**Change** the `trimWithMemoryModel` signature: replace `config: ModelConfig` with `model: LanguageModel`.

**Change** the `generateText` call inside `trimWithMemoryModel`: replace `model: buildMemoryModel(config)` with `model`.

Here is the exact diff for `src/memory.ts`:

**Remove these lines (around line 1-2):**

```typescript
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
```

**Change this import (around line 2):**

```typescript
// Before:
import { generateText, Output } from 'ai'
import { type ModelMessage } from 'ai'

// After:
import { generateText, Output } from 'ai'
import { type LanguageModel, type ModelMessage } from 'ai'
```

**Remove these lines (around line 20-24):**

```typescript
export type ModelConfig = {
  readonly apiKey: string
  readonly baseUrl: string
  readonly model: string
}
```

**Remove this function (around line 228-229):**

```typescript
const buildMemoryModel = (config: ModelConfig): ReturnType<ReturnType<typeof createOpenAICompatible>> =>
  createOpenAICompatible({ name: 'openai-compatible', apiKey: config.apiKey, baseURL: config.baseUrl })(config.model)
```

**Change `trimWithMemoryModel` signature (around line 231-236):**

```typescript
// Before:
export async function trimWithMemoryModel(
  history: readonly ModelMessage[],
  trimMin: number,
  trimMax: number,
  previousSummary: string | null,
  config: ModelConfig,
): Promise<TrimResult> {

// After:
export async function trimWithMemoryModel(
  history: readonly ModelMessage[],
  trimMin: number,
  trimMax: number,
  previousSummary: string | null,
  model: LanguageModel,
): Promise<TrimResult> {
```

**Change `generateText` call inside the function (around line 251-255):**

```typescript
// Before:
const result = await generateText({
  model: buildMemoryModel(config),
  output: Output.object({ schema: TrimResultSchema }),
  prompt,
})

// After:
const result = await generateText({
  model,
  output: Output.object({ schema: TrimResultSchema }),
  prompt,
})
```

### Step 4: Update `src/conversation.ts`

`conversation.ts` is the only call site for `trimWithMemoryModel`. It currently passes a `ModelConfig`; it must now build the model and pass it.

**Add this import** (at the top of `src/conversation.ts`):

```typescript
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
```

**Add this private helper** (after the `log` line, before `buildMessagesWithMemory`):

```typescript
const buildModel = (apiKey: string, baseUrl: string, modelName: string) =>
  createOpenAICompatible({ name: 'openai-compatible', apiKey, baseURL: baseUrl })(modelName)
```

**Change the call site** inside `trimAndSummarise` (around line 52):

```typescript
// Before:
const { trimmedMessages, summary } = await trimWithMemoryModel(history, TRIM_MIN, TRIM_MAX, existing, {
  apiKey: llmApiKey,
  baseUrl: llmBaseUrl,
  model: smallModel,
})

// After:
const model = buildModel(llmApiKey, llmBaseUrl, smallModel)
const { trimmedMessages, summary } = await trimWithMemoryModel(history, TRIM_MIN, TRIM_MAX, existing, model)
```

### Step 5: Run the memory tests

```bash
bun test tests/memory.test.ts
```

Expected: all tests pass, including all four `trimWithMemoryModel` cases.

### Step 6: Run the full test suite

```bash
bun test
```

Expected: all tests pass with 0 failures.

### Step 7: Lint

```bash
bun run lint
```

Expected: no lint errors. Verify `ModelConfig` is not referenced anywhere else:

```bash
grep -r 'ModelConfig' src/ tests/
```

Expected: 0 matches (the type is removed).

### Step 8: Commit

```bash
git add src/memory.ts src/conversation.ts tests/memory.test.ts
git commit -m "refactor: accept LanguageModel instance in trimWithMemoryModel

Remove ModelConfig type and buildMemoryModel from memory.ts — these were
AI SDK infrastructure concerns living in the persistence/application layer.

conversation.ts now builds the model and passes it in, keeping model
construction at the orchestration layer where LLM config is already read."
```

---

## Verification

After both tasks, verify the full architecture:

```bash
# All tests green
bun test

# No lint issues
bun run lint

# bot.ts should be <60 lines
wc -l src/bot.ts

# memory.ts should not import @ai-sdk/openai-compatible
grep 'openai-compatible' src/memory.ts  # should return nothing

# llm-orchestrator.ts exists and exports processMessage
grep 'export' src/llm-orchestrator.ts
```

---

## What this achieves

| Before                                                                          | After                                                              |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `bot.ts`: 230 lines, 12 private functions, mixed Grammy + LLM + config concerns | `bot.ts`: ~45 lines — Grammy wiring only                           |
| `memory.ts`: imports `@ai-sdk/openai-compatible`, builds model instances        | `memory.ts`: no AI SDK dependency, pure persistence + schema logic |
| `conversation.ts`: passes config credentials to memory layer to build model     | `conversation.ts`: builds model itself, passes instance down       |
