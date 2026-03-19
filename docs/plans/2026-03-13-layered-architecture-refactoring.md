# Layered Architecture Refactoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve architectural compliance by enforcing clean layer boundaries across the codebase: extract LLM orchestration from the bot presentation layer, decouple the memory module from AI SDK infrastructure, relocate misplaced schema files into their provider boundaries, and consolidate Kaneo-specific provisioning logic out of the presentation layer.

**Architecture:** Four targeted refactors: (1) move all LLM pipeline logic from `bot.ts` into a dedicated `llm-orchestrator.ts` module so `bot.ts` becomes a thin Grammy wiring layer; (2) change `trimWithMemoryModel` in `memory.ts` to accept a pre-built model instance instead of constructing it internally, removing AI SDK infrastructure from the application/persistence layer; (3) relocate root-level `schemas/` into their respective provider directories to fix module boundary encapsulation; (4) extract shared Kaneo provisioning logic to eliminate presentation-layer knowledge of a specific provider implementation.

**Tech Stack:** Bun, TypeScript, Grammy, Vercel AI SDK (`ai`, `@ai-sdk/openai-compatible`), pino, SQLite

---

## Background: Architectural audit findings

Full audit of 130+ source files against the layered architecture (presentation → orchestration → application/domain → infrastructure). Files reviewed and found compliant are listed in the audit appendix. The four violations below require action:

| #   | Issue                                                                                                                 | Layer violation                                               |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | `bot.ts` contains 14+ private orchestration functions alongside Grammy wiring                                         | Presentation layer owns orchestration + infrastructure logic  |
| 2   | `memory.ts` imports `@ai-sdk/openai-compatible` and calls `createOpenAICompatible`                                    | Application layer directly uses AI SDK infrastructure         |
| 3   | `schemas/kaneo/` and `schemas/youtrack/` live at project root, imported via `../../../schemas/` by 27+ provider files | Provider-specific schemas leak outside their module boundary  |
| 4   | `commands/admin.ts` and `bot.ts` both import `providers/kaneo/provision.js` directly                                  | Presentation layer has hard dependency on a specific provider |

All fixes are purely organizational — no behavior changes, no new features.

---

## Task 1: Extract `LlmOrchestrator` module from `bot.ts`

**Files:**

- Create: `src/llm-orchestrator.ts`
- Modify: `src/bot.ts`
- Test: `tests/bot.test.ts` (verify existing tests still pass — no new test needed)

### What moves

All non-Grammy logic currently in `bot.ts` moves to `src/llm-orchestrator.ts`:

| Function                  | Current location | Destination           |
| ------------------------- | ---------------- | --------------------- |
| `BASE_SYSTEM_PROMPT`      | `bot.ts:30`      | `llm-orchestrator.ts` |
| `buildSystemPrompt`       | `bot.ts:62`      | `llm-orchestrator.ts` |
| `buildOpenAI`             | `bot.ts:80`      | `llm-orchestrator.ts` |
| `checkRequiredConfig`     | `bot.ts:83`      | `llm-orchestrator.ts` |
| `persistFactsFromResults` | `bot.ts:91`      | `llm-orchestrator.ts` |
| `withTypingIndicator`     | `bot.ts:102`     | `llm-orchestrator.ts` |
| `maybeProvisionKaneo`     | `bot.ts:115`     | `llm-orchestrator.ts` |
| `buildProvider`           | `bot.ts:143`     | `llm-orchestrator.ts` |
| `isToolSet`               | `bot.ts:167`     | `llm-orchestrator.ts` |
| `getOrCreateTools`        | `bot.ts:170`     | `llm-orchestrator.ts` |
| `sendLlmResponse`         | `bot.ts:182`     | `llm-orchestrator.ts` |
| `callLlm`                 | `bot.ts:197`     | `llm-orchestrator.ts` |
| `handleMessageError`      | `bot.ts:230`     | `llm-orchestrator.ts` |
| `processMessage`          | `bot.ts:240`     | `llm-orchestrator.ts` |

**Stays in `bot.ts`:** `checkAuthorization`, `bot` instance, command registrations, `message:text` handler.

### Step 1: Run current tests to establish baseline

```bash
bun test tests/bot.test.ts
```

Expected: all tests pass. Note the count so you can verify nothing regresses.

### Step 2: Create `src/llm-orchestrator.ts`

```typescript
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { APICallError } from '@ai-sdk/provider'
import { generateText, stepCountIs, type ToolSet } from 'ai'
import { type ModelMessage } from 'ai'
import type { Context } from 'grammy'

import { clearCachedTools, getCachedHistory, getCachedTools, setCachedTools } from './cache.js'
import { getConfig, setConfig } from './config.js'
import { buildMessagesWithMemory, runTrimInBackground, shouldTriggerTrim } from './conversation.js'
import { getUserMessage, isAppError } from './errors.js'
import { appendHistory, saveHistory } from './history.js'
import { logger } from './logger.js'
import { extractFactsFromSdkResults, upsertFact } from './memory.js'
import { createProvider } from './providers/registry.js'
import type { TaskProvider } from './providers/types.js'
import { makeTools } from './tools/index.js'
import { getKaneoWorkspace, setKaneoWorkspace } from './users.js'
import { formatLlmOutput } from './utils/format.js'

const log = logger.child({ scope: 'llm-orchestrator' })

const BASE_SYSTEM_PROMPT = `You are papai, a personal assistant that helps the user manage their tasks directly from Telegram.
Current date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.

When the user asks you to do something, figure out which tool(s) to call and execute them autonomously — fetch any missing context (projects, columns, task details) with additional tool calls before acting, without asking the user.

WORKFLOW:
1. Understand the user's intent from natural language.
2. Gather context if needed (e.g. call list_projects to resolve a project name, call list_columns before setting a task status).
3. Call the appropriate tool(s) to fulfil the request.
4. Reply with a concise confirmation.

AMBIGUITY — When the user's phrasing implies a single target (uses "the task", "it", "that one", or a specific title) but the search returns multiple equally-likely candidates, ask ONE short question to disambiguate before acting. When the phrasing implies multiple targets ("all", "every", "these", plural nouns), operate on all matches without asking. For referential phrases ("move it", "close that"), resolve from conversation context first; only ask if truly unresolvable.

DESTRUCTIVE ACTIONS — archive_task, archive_project, delete_column, remove_label:
These tools require a confidence field (0–1) reflecting how explicitly the user requested the action.
- Set 1.0 when the user has already confirmed (e.g. replied "yes").
- Set 0.9 for a direct, unambiguous command ("archive the Auth project").
- Set ≤0.7 when the intent is indirect or inferred.
If the tool returns { status: "confirmation_required", message: "..." }, send the message to the user as a natural question and wait for their reply before retrying the tool call with confidence 1.0.

RELATION TYPES — map user language to the correct type when calling add_task_relation / update_task_relation:
- "depends on" / "blocked by" / "waiting on" → blocked_by
- "blocks" / "is blocking" → blocks
- "duplicate of" / "same as" / "copy of" / "identical to" → duplicate
- "child of" / "subtask of" / "part of" → parent
- "related to" / "linked to" / anything else → related

OUTPUT RULES:
- When referencing tasks or projects, format them as Markdown links: [Task title](url). Never output raw IDs.
- Keep replies short and friendly.
- Don't use tables.`

const buildSystemPrompt = (provider: TaskProvider): string => {
  const addendum = provider.getPromptAddendum()
  if (addendum === '') return BASE_SYSTEM_PROMPT
  return `${BASE_SYSTEM_PROMPT}\n\n${addendum}`
}

const buildOpenAI = (apiKey: string, baseURL: string): ReturnType<typeof createOpenAICompatible> =>
  createOpenAICompatible({ name: 'openai-compatible', apiKey, baseURL })

const checkRequiredConfig = (userId: number): string[] => {
  const llmKeys = ['llm_apikey', 'llm_baseurl', 'main_model'] as const
  const providerName = getConfig(userId, 'provider') ?? 'kaneo'
  const providerKeys =
    providerName === 'youtrack' ? (['youtrack_url', 'youtrack_token'] as const) : (['kaneo_apikey'] as const)
  return [...llmKeys, ...providerKeys].filter((k) => getConfig(userId, k) === null)
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
    const { provisionKaneoUser } = await import('./providers/kaneo/provision.js')
    const kaneoInternalUrl = process.env['KANEO_INTERNAL_URL'] ?? kaneoUrl
    const prov = await provisionKaneoUser(kaneoInternalUrl, kaneoUrl, userId, ctx.from?.username ?? null)
    setConfig(userId, 'kaneo_apikey', prov.kaneoKey)
    setKaneoWorkspace(userId, prov.workspaceId)
    // Clear tools cache since kaneo config changed
    clearCachedTools(userId)
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

const buildProvider = (userId: number): TaskProvider => {
  const providerName = getConfig(userId, 'provider') ?? 'kaneo'
  log.debug({ userId, providerName }, 'Building provider')

  if (providerName === 'kaneo') {
    const kaneoKey = getConfig(userId, 'kaneo_apikey')!
    const kaneoBaseUrl = process.env['KANEO_CLIENT_URL']!
    const workspaceId = getKaneoWorkspace(userId)!
    const isSessionCookie = kaneoKey.startsWith('better-auth.session_token=')
    const config: Record<string, string> = isSessionCookie
      ? { baseUrl: kaneoBaseUrl, sessionCookie: kaneoKey, workspaceId }
      : { apiKey: kaneoKey, baseUrl: kaneoBaseUrl, workspaceId }
    return createProvider('kaneo', config)
  }

  if (providerName === 'youtrack') {
    const baseUrl = getConfig(userId, 'youtrack_url')!
    const token = getConfig(userId, 'youtrack_token')!
    return createProvider('youtrack', { baseUrl, token })
  }

  return createProvider(providerName, {})
}

const isToolSet = (value: unknown): value is ToolSet =>
  typeof value === 'object' && value !== null && Object.keys(value).length > 0

const getOrCreateTools = (userId: number, provider: TaskProvider): ToolSet => {
  const cachedTools = getCachedTools(userId)
  if (cachedTools !== undefined && cachedTools !== null && isToolSet(cachedTools)) {
    log.debug({ userId }, 'Using cached tools')
    return cachedTools
  }
  log.debug({ userId }, 'Building tools (cache miss)')
  const tools = makeTools(provider)
  setCachedTools(userId, tools)
  return tools
}

const sendLlmResponse = async (
  ctx: Context,
  userId: number,
  result: { text?: string; toolCalls?: unknown[]; response: { messages: ModelMessage[] } },
): Promise<void> => {
  const assistantText = result.text
  const textToFormat = assistantText !== undefined && assistantText !== '' ? assistantText : 'Done.'
  const formatted = formatLlmOutput(textToFormat)
  await ctx.reply(formatted.text, { entities: formatted.entities })
  log.info(
    { userId, responseLength: assistantText?.length ?? 0, toolCalls: result.toolCalls?.length ?? 0 },
    'Response sent successfully',
  )
}

const callLlm = async (
  ctx: Context,
  userId: number,
  history: readonly ModelMessage[],
): Promise<{ response: { messages: ModelMessage[] } }> => {
  await maybeProvisionKaneo(ctx, userId)
  const missing = checkRequiredConfig(userId)
  if (missing.length > 0) {
    log.warn({ userId, missing }, 'Missing required config keys')
    await ctx.reply(`Missing configuration: ${missing.join(', ')}.\nUse /set <key> <value> to configure.`)
    throw new Error('Missing configuration')
  }
  const llmApiKey = getConfig(userId, 'llm_apikey')!
  const llmBaseUrl = getConfig(userId, 'llm_baseurl')!
  const mainModel = getConfig(userId, 'main_model')!
  const model = buildOpenAI(llmApiKey, llmBaseUrl)(mainModel)
  const provider = buildProvider(userId)
  const tools = getOrCreateTools(userId, provider)
  const { messages: messagesWithMemory, memoryMsg } = buildMessagesWithMemory(userId, history)
  log.debug({ userId, historyLength: history.length, hasMemory: memoryMsg !== null }, 'Calling generateText')
  const result = await generateText({
    model,
    system: buildSystemPrompt(provider),
    messages: messagesWithMemory,
    tools,
    stopWhen: stepCountIs(25),
  })
  log.debug({ userId, toolCalls: result.toolCalls?.length, usage: result.usage }, 'LLM response received')
  persistFactsFromResults(userId, result.toolCalls, result.toolResults)
  await sendLlmResponse(ctx, userId, result)
  return result
}

const handleMessageError = async (ctx: Context, _userId: number, error: unknown): Promise<void> => {
  if (isAppError(error)) {
    await ctx.reply(getUserMessage(error))
  } else if (APICallError.isInstance(error)) {
    await ctx.reply('An unexpected error occurred. Please try again later.')
  } else {
    await ctx.reply('An unexpected error occurred. Please try again later.')
  }
}

export const processMessage = async (ctx: Context, userId: number, userText: string): Promise<void> => {
  log.debug({ userId, userText }, 'processMessage called')
  log.info({ userId, messageLength: userText.length }, 'Message received from user')

  const baseHistory = getCachedHistory(userId)
  const newMessage: ModelMessage = { role: 'user', content: userText }
  const history = [...baseHistory, newMessage]

  appendHistory(userId, [newMessage])

  try {
    const result = await withTypingIndicator(ctx, () => callLlm(ctx, userId, history))

    const assistantMessages = result.response.messages
    if (assistantMessages.length > 0) {
      appendHistory(userId, assistantMessages)
      log.debug({ userId, assistantMessagesCount: assistantMessages.length }, 'Assistant response appended to history')
    }

    const needsTrim = shouldTriggerTrim([...history, ...assistantMessages])
    if (needsTrim) {
      void runTrimInBackground(userId, [...history, ...assistantMessages])
    }
  } catch (error) {
    saveHistory(userId, baseHistory)
    await handleMessageError(ctx, userId, error)
  }
}
```

**Note:** `withTypingIndicator` now wraps `callLlm` inside `processMessage` (moved from the bot handler level). This keeps the typing indicator as an orchestration concern.

### Step 3: Rewrite `src/bot.ts`

Replace the entire file with this slimmed-down version:

```typescript
import { Bot } from 'grammy'

import {
  registerAdminCommands,
  registerClearCommand,
  registerConfigCommand,
  registerContextCommand,
  registerHelpCommand,
  registerSetCommand,
} from './commands/index.js'
import { logger } from './logger.js'
import { processMessage } from './llm-orchestrator.js'
import { isAuthorized, resolveUserByUsername } from './users.js'

const log = logger.child({ scope: 'bot' })
const adminUserId = parseInt(process.env['TELEGRAM_USER_ID']!, 10)

const bot = new Bot(process.env['TELEGRAM_BOT_TOKEN']!)

const checkAuthorization = (userId: number | undefined, username?: string): userId is number => {
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
registerContextCommand(bot, adminUserId)
registerClearCommand(bot, checkAuthorization, adminUserId)
registerAdminCommands(bot, adminUserId)

bot.on('message:text', async (ctx) => {
  const userId = ctx.from?.id
  if (!checkAuthorization(userId, ctx.from?.username)) {
    return
  }
  await processMessage(ctx, userId, ctx.message.text)
})

export { bot }
```

### Step 4: Run the tests

```bash
bun test tests/bot.test.ts
```

Expected: same pass count as Step 1 baseline. The test imports `bot` from `../src/bot.js` which still exports it; `formatLlmOutput` is imported directly from `../src/utils/format.js` and is not affected.

### Step 5: Run the full test suite

```bash
bun test
```

Expected: all existing tests pass with 0 failures.

### Step 6: Lint

```bash
bun run lint
```

Expected: no lint errors.

### Step 7: Commit

```bash
git add src/llm-orchestrator.ts src/bot.ts
git commit -m "refactor: extract LLM orchestration module from bot.ts

Move all LLM pipeline logic (processMessage, callLlm, maybeProvisionKaneo,
buildProvider, getOrCreateTools, sendLlmResponse, persistFactsFromResults,
withTypingIndicator, handleMessageError, buildOpenAI, checkRequiredConfig,
buildSystemPrompt, BASE_SYSTEM_PROMPT) into src/llm-orchestrator.ts.

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
// Current (tests/memory.test.ts ~line 391):
const result = await trimWithMemoryModel(history, 2, 10, null, {
  apiKey: 'key',
  baseUrl: 'http://localhost',
  model: 'test-model',
})
```

Update **all five** `trimWithMemoryModel` test cases to pass a mock model instead. Since `generateText` is already mocked at the module level, the model instance is never actually called — pass an empty object cast to the right type:

```typescript
// Add this import at the top of the describe block or at file top
import type { LanguageModel } from 'ai'

// Use in each test:
const mockModel = {} as LanguageModel

// Replace all five calls:
const result = await trimWithMemoryModel(history, 2, 10, null, mockModel)
```

The five tests to update are at approximately lines 391, 409, 424, 440, 454 in `tests/memory.test.ts`. Each one currently ends with `{ apiKey: 'key', baseUrl: 'http://localhost', model: 'test-model' }` — replace that argument with `mockModel`.

### Step 2: Run the updated tests — expect failure

```bash
bun test tests/memory.test.ts --test-name-pattern "trimWithMemoryModel"
```

Expected: TypeScript type error or runtime mismatch because `trimWithMemoryModel` still expects `ModelConfig`. This confirms the test is driving the change.

### Step 3: Update `src/memory.ts`

**Remove:**

- The import of `createOpenAICompatible` from `@ai-sdk/openai-compatible` (line 1)
- The `ModelConfig` type (lines 13–17)
- The private `buildMemoryModel` function (lines 153–154)

**Add:**

- Import `type LanguageModel` from `'ai'` (merge with existing `ai` import)

**Change** the `trimWithMemoryModel` signature (line 156): replace `config: ModelConfig` with `model: LanguageModel`.

**Change** the `generateText` call inside `trimWithMemoryModel` (line 177): replace `model: buildMemoryModel(config)` with `model`.

Here is the exact diff for `src/memory.ts`:

**Remove this import (line 1):**

```typescript
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
```

**Change this import (line 2):**

```typescript
// Before:
import { generateText, Output } from 'ai'
import { type ModelMessage } from 'ai'

// After:
import { generateText, Output } from 'ai'
import { type LanguageModel, type ModelMessage } from 'ai'
```

**Remove these lines (lines 13–17):**

```typescript
type ModelConfig = {
  readonly apiKey: string
  readonly baseUrl: string
  readonly model: string
}
```

**Remove this function (lines 153–154):**

```typescript
const buildMemoryModel = (config: ModelConfig): ReturnType<ReturnType<typeof createOpenAICompatible>> =>
  createOpenAICompatible({ name: 'openai-compatible', apiKey: config.apiKey, baseURL: config.baseUrl })(config.model)
```

**Change `trimWithMemoryModel` signature (line 156–162):**

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

**Change `generateText` call inside the function (line 176–180):**

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

`conversation.ts` is the only call site for `trimWithMemoryModel`. It currently passes a `ModelConfig` object in `runTrimInBackground`; it must now build the model and pass it.

**Add this import** (at the top of `src/conversation.ts`):

```typescript
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
```

**Add this private helper** (after the `log` line, before `buildMessagesWithMemory`):

```typescript
const buildModel = (apiKey: string, baseUrl: string, modelName: string) =>
  createOpenAICompatible({ name: 'openai-compatible', apiKey, baseURL: baseUrl })(modelName)
```

**Change the call site** inside `runTrimInBackground` (around line 44):

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

Expected: all tests pass, including all five `trimWithMemoryModel` cases.

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

## Task 3: Relocate `schemas/` into provider directories

**Files:**

- Move: `schemas/kaneo/*.ts` (13 files) → `src/providers/kaneo/schemas/`
- Move: `schemas/youtrack/*.ts` (11 files) → `src/providers/youtrack/schemas/`
- Update: ~27 import paths in `src/providers/kaneo/*.ts` and `src/providers/youtrack/*.ts`
- Delete: empty `schemas/` root directory

**Context:** Provider-specific Zod validation schemas currently live at the project root (`schemas/kaneo/`, `schemas/youtrack/`). They are imported exclusively by their respective provider files via fragile `../../../schemas/` paths. This violates module boundary encapsulation — provider implementation details leak outside the provider directory. CLAUDE.md already documents the intended location as `src/providers/kaneo/schemas/`.

### Step 1: Run tests to establish baseline

```bash
bun test
```

### Step 2: Move schema files

```bash
# Kaneo schemas (13 files)
mv schemas/kaneo/*.ts src/providers/kaneo/schemas/

# YouTrack schemas (11 files)
mv schemas/youtrack/*.ts src/providers/youtrack/schemas/

# Remove empty root schemas directory
rmdir schemas/youtrack schemas/kaneo schemas
```

### Step 3: Update import paths

All `../../../schemas/kaneo/` imports in `src/providers/kaneo/*.ts` become `./schemas/`:

```typescript
// Before:
import { TaskSchema } from '../../../schemas/kaneo/create-task.js'

// After:
import { TaskSchema } from './schemas/create-task.js'
```

All `../../../schemas/youtrack/` imports in `src/providers/youtrack/*.ts` become `./schemas/`:

```typescript
// Before:
import { YtIssueTagsSchema } from '../../../schemas/youtrack/yt-types.js'

// After:
import { YtIssueTagsSchema } from './schemas/yt-types.js'
```

**Files to update (Kaneo — `../../../schemas/kaneo/` → `./schemas/`):**

| File                     | Schemas imported                      |
| ------------------------ | ------------------------------------- |
| `task-resource.ts`       | `create-task.js`                      |
| `task-update-helpers.ts` | `create-task.js`                      |
| `task-archive.ts`        | `create-label.js`                     |
| `task-list-schema.ts`    | `api-compat.js`                       |
| `task-relations.ts`      | `get-task.js`                         |
| `search-tasks.ts`        | `api-compat.js`, `global-search.js`   |
| `project-resource.ts`    | `get-project.js`, `update-project.js` |
| `column-resource.ts`     | `api-compat.js`                       |
| `comment-resource.ts`    | `api-compat.js`, `get-activities.js`  |
| `label-resource.ts`      | `create-label.js`                     |
| `create-column.ts`       | `api-compat.js`                       |
| `create-label.ts`        | `create-label.js`                     |
| `create-project.ts`      | `update-project.js`                   |
| `create-task.ts`         | `create-task.js`                      |
| `delete-column.ts`       | — (uses `kaneo-client.js`)            |
| `list-columns.ts`        | `api-compat.js`                       |
| `list-labels.ts`         | `create-label.js`                     |
| `list-projects.ts`       | `update-project.js`                   |
| `mappers.ts`             | `create-task.js`                      |
| `update-column.ts`       | `api-compat.js`                       |
| `update-label.ts`        | `create-label.js`                     |
| `update-project.ts`      | `update-project.js`                   |
| `update-task.ts`         | `create-task.js`                      |

**Files to update (YouTrack — `../../../schemas/youtrack/` → `./schemas/`):**

| File           | Schemas imported |
| -------------- | ---------------- |
| `labels.ts`    | `yt-types.js`    |
| `mappers.ts`   | `yt-types.js`    |
| `relations.ts` | `yt-types.js`    |

Also check `tests/` for any direct schema imports:

```bash
grep -r '../schemas/' tests/ --include='*.ts'
```

Update any test imports to point to the new locations.

### Step 4: Run the full test suite

```bash
bun test
```

Expected: all tests pass with 0 failures.

### Step 5: Lint and typecheck

```bash
bun run lint && bun run typecheck
```

Expected: no errors. Verify no `../../../schemas/` paths remain:

```bash
grep -r '\.\./\.\./\.\./schemas' src/ tests/
```

Expected: 0 matches.

### Step 6: Commit

```bash
git add -A schemas/ src/providers/kaneo/schemas/ src/providers/youtrack/schemas/ src/providers/
git commit -m "refactor: relocate schemas into provider directories

Move schemas/kaneo/ → src/providers/kaneo/schemas/ (13 files) and
schemas/youtrack/ → src/providers/youtrack/schemas/ (11 files).

Provider-specific validation schemas now live inside their provider
module boundary instead of at the project root. Eliminates fragile
../../../schemas/ import paths."
```

---

## Task 4: Extract shared Kaneo provisioning service

**Files:**

- Modify: `src/providers/kaneo/provision.ts`
- Modify: `src/commands/admin.ts`
- Modify: `src/bot.ts` (or `src/llm-orchestrator.ts` if Task 1 completed first)

**Context:** Two presentation-layer files contain Kaneo-specific provisioning logic that calls `provisionKaneoUser`, then stores the result via `setConfig` and `setKaneoWorkspace`:

- `bot.ts:maybeProvisionKaneo` (lines 115–141) — auto-provisions on first message
- `commands/admin.ts:provisionUserKaneo` (lines 73–89) — provisions when admin adds a user

Both import directly from `providers/kaneo/provision.js`, making the presentation layer aware of a specific provider. The fix: expose a higher-level `provisionAndConfigure` function from `provision.ts` that handles both the API call and the config/workspace storage, so callers don't need Kaneo-specific knowledge.

### Step 1: Run tests to establish baseline

```bash
bun test
```

### Step 2: Add `provisionAndConfigure` to `src/providers/kaneo/provision.ts`

Add a new export at the end of the file that consolidates the shared post-provisioning side effects:

```typescript
import { clearCachedTools } from '../../cache.js'
import { setConfig } from '../../config.js'
import { setKaneoWorkspace } from '../../users.js'

// ... (existing code) ...

export type ProvisionOutcome =
  | { status: 'provisioned'; email: string; password: string; kaneoUrl: string }
  | { status: 'registration_disabled' }
  | { status: 'failed'; error: string }

/**
 * High-level provisioning: creates the Kaneo account AND stores credentials
 * in the user's config. Callers don't need to know about config keys or
 * workspace storage.
 */
export async function provisionAndConfigure(userId: number, username: string | null): Promise<ProvisionOutcome> {
  const kaneoUrl = process.env['KANEO_CLIENT_URL']
  if (kaneoUrl === undefined) return { status: 'failed', error: 'KANEO_CLIENT_URL not set' }

  try {
    const kaneoInternalUrl = process.env['KANEO_INTERNAL_URL'] ?? kaneoUrl
    const result = await provisionKaneoUser(kaneoInternalUrl, kaneoUrl, userId, username)
    setConfig(userId, 'kaneo_apikey', result.kaneoKey)
    setKaneoWorkspace(userId, result.workspaceId)
    clearCachedTools(userId)
    log.info({ userId }, 'Kaneo account provisioned and configured')
    return { status: 'provisioned', email: result.email, password: result.password, kaneoUrl }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    const isRegistrationDisabled = msg.includes('sign-up') || msg.includes('registration') || msg.includes('Sign-up')
    log.warn({ userId, error: msg }, 'Kaneo provisioning failed')
    if (isRegistrationDisabled) return { status: 'registration_disabled' }
    return { status: 'failed', error: msg }
  }
}
```

### Step 3: Simplify `maybeProvisionKaneo` in orchestrator

In `src/llm-orchestrator.ts` (or `src/bot.ts` if Task 1 not yet completed), replace the inline provisioning logic:

```typescript
// Before: direct import of provisionKaneoUser, inline setConfig/setKaneoWorkspace/clearCachedTools
// After:
import { provisionAndConfigure } from './providers/kaneo/provision.js'

const maybeProvisionKaneo = async (ctx: Context, userId: number): Promise<void> => {
  if (getKaneoWorkspace(userId) !== null && getConfig(userId, 'kaneo_apikey') !== null) return
  const outcome = await provisionAndConfigure(userId, ctx.from?.username ?? null)
  if (outcome.status === 'provisioned') {
    await ctx.reply(
      `✅ Your Kaneo account has been created!\n🌐 ${outcome.kaneoUrl}\n📧 Email: ${outcome.email}\n🔑 Password: ${outcome.password}\n\nThe bot is already configured and ready to use.`,
    )
  } else if (outcome.status === 'registration_disabled') {
    await ctx.reply(
      'Kaneo account could not be created — registration is currently disabled on this instance.\n\nPlease ask the admin to provision your account.',
    )
  }
}
```

This removes the `setConfig`, `setKaneoWorkspace`, and `clearCachedTools` imports from the orchestrator (they are now internal to `provisionAndConfigure`).

### Step 4: Simplify `provisionUserKaneo` in `commands/admin.ts`

Replace the inline provisioning logic:

```typescript
// Before: direct import of provisionKaneoUser, inline setConfig/setKaneoWorkspace
// After:
import { provisionAndConfigure } from '../providers/kaneo/provision.js'

async function provisionUserKaneo(ctx: { reply: (text: string) => Promise<unknown> }, userId: number): Promise<void> {
  const outcome = await provisionAndConfigure(userId, null)
  if (outcome.status === 'provisioned') {
    await ctx.reply(
      `Kaneo account created.\n📧 Email: ${outcome.email}\n🔑 Password: ${outcome.password}\n🌐 ${outcome.kaneoUrl}`,
    )
  } else if (outcome.status === 'failed') {
    await ctx.reply(`Note: Kaneo auto-provisioning failed (${outcome.error}). User can configure manually via /set.`)
  }
}
```

Remove the `setConfig` and `setKaneoWorkspace` imports from `admin.ts` (they are now internal to `provisionAndConfigure`).

### Step 5: Run the full test suite

```bash
bun test
```

Expected: all tests pass with 0 failures.

### Step 6: Lint

```bash
bun run lint
```

Expected: no lint errors.

### Step 7: Commit

```bash
git add src/providers/kaneo/provision.ts src/commands/admin.ts src/bot.ts
git commit -m "refactor: extract shared Kaneo provisioning service

Add provisionAndConfigure() to provision.ts that handles both the API
call and config/workspace storage. bot.ts and commands/admin.ts now call
this single entry point instead of duplicating setConfig/setKaneoWorkspace
logic. Reduces presentation-layer knowledge of Kaneo internals."
```

---

## Verification

After all four tasks, verify the full architecture:

```bash
# All tests green
bun test

# No lint issues
bun run lint

# bot.ts should be ~50 lines
wc -l src/bot.ts

# memory.ts should not import @ai-sdk/openai-compatible
grep 'openai-compatible' src/memory.ts  # should return nothing

# llm-orchestrator.ts exists and exports processMessage
grep 'export' src/llm-orchestrator.ts

# No root-level schemas remain
ls schemas/ 2>/dev/null && echo "FAIL: schemas/ still exists" || echo "OK"

# No fragile ../../../schemas/ imports
grep -r '\.\./\.\./\.\./schemas' src/ tests/ && echo "FAIL" || echo "OK"

# Provisioning logic consolidated
grep -c 'setKaneoWorkspace' src/commands/admin.ts src/bot.ts src/llm-orchestrator.ts 2>/dev/null
# Expected: 0 in each — setKaneoWorkspace is now internal to provision.ts
```

---

## Audit: Files reviewed and found compliant

The following files were reviewed during the architectural audit and found to comply with layered architecture boundaries. No action needed.

**Presentation layer (commands/):**

| File                  | Assessment                                                             |
| --------------------- | ---------------------------------------------------------------------- |
| `commands/help.ts`    | Pure presentation — static text, no domain logic                       |
| `commands/set.ts`     | Thin wrapper — parses input, delegates to `setConfig()`                |
| `commands/config.ts`  | Thin wrapper — reads config, formats output                            |
| `commands/clear.ts`   | Thin wrapper — delegates to `clearHistory`/`clearSummary`/`clearFacts` |
| `commands/context.ts` | Reads from application APIs, formats for Telegram output               |
| `commands/index.ts`   | Re-exports only                                                        |

**Application/domain layer:**

| File                                    | Assessment                              |
| --------------------------------------- | --------------------------------------- |
| `config.ts`                             | Clean — delegates to cache layer        |
| `users.ts`                              | Clean — delegates to cache/db layers    |
| `errors.ts`                             | Pure domain error definitions           |
| `history.ts`                            | Clean — delegates to cache layer        |
| `announcements.ts`                      | Clean — reads changelog, uses users API |
| `types/config.ts`, `types/memory.ts`    | Pure type definitions                   |
| `utils/format.ts`, `utils/changelog.ts` | Pure utility functions                  |

**Provider layer:**

| File                                                  | Assessment                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------- |
| `providers/types.ts`                                  | Pure interface — zero infrastructure imports                              |
| `providers/errors.ts`                                 | Pure error types                                                          |
| `providers/registry.ts`                               | Factory pattern — imports provider constructors, exports `createProvider` |
| `providers/kaneo/index.ts`                            | `KaneoProvider` implements `TaskProvider` — correct delegation            |
| `providers/kaneo/client.ts`                           | HTTP client — correct infrastructure placement                            |
| `providers/kaneo/kaneo-client.ts`                     | Facade composing resource classes — provider-internal                     |
| `providers/kaneo/*-resource.ts`                       | Resource classes using `kaneoFetch` — provider-internal                   |
| `providers/kaneo/operations/*.ts`                     | Operation functions — provider-internal                                   |
| `providers/kaneo/classify-error.ts`                   | Error mapping — provider-internal                                         |
| `providers/kaneo/frontmatter.ts`                      | Domain logic for relation storage — provider-internal                     |
| `providers/kaneo/url-builder.ts`                      | Pure utility — no external dependencies                                   |
| `providers/kaneo/api-error.ts`, `validation-error.ts` | Error classes — provider-internal                                         |
| `providers/kaneo/constants.ts`                        | Capability definitions — imports only from `types.ts`                     |
| `providers/kaneo/mappers.ts`                          | Data mapping — provider-internal                                          |
| `providers/youtrack/index.ts`                         | `YouTrackProvider` implements `TaskProvider` — correct delegation         |
| `providers/youtrack/client.ts`                        | HTTP client — correct infrastructure placement                            |
| `providers/youtrack/operations/*.ts`                  | Operation functions — provider-internal                                   |
| `providers/youtrack/constants.ts`                     | Capability definitions                                                    |

**Tools layer:**

| File                         | Assessment                                                              |
| ---------------------------- | ----------------------------------------------------------------------- |
| `tools/index.ts`             | Capability-gated assembly — depends only on `providers/types.ts`        |
| `tools/*.ts` (31 files)      | Each depends on `ai` (tool definition) + `providers/types.ts` — correct |
| `tools/confirmation-gate.ts` | Pure Zod schema + threshold check — no external dependencies            |

**Infrastructure layer:**

| File                           | Assessment                                          |
| ------------------------------ | --------------------------------------------------- |
| `logger.ts`                    | pino instance — pure infrastructure                 |
| `cache.ts`                     | In-memory cache with DB sync — clean infrastructure |
| `cache-db.ts`                  | `queueMicrotask` DB sync — infrastructure           |
| `cache-helpers.ts`             | JSON parsing helpers — infrastructure               |
| `db/index.ts`, `db/migrate.ts` | SQLite setup — pure infrastructure                  |
| `db/migrations/*.ts` (6 files) | Schema migrations — pure infrastructure             |

---

## What this achieves

| Before                                                                          | After                                                                     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `bot.ts`: 290 lines, 14 private functions, mixed Grammy + LLM + config concerns | `bot.ts`: ~50 lines — Grammy wiring only                                  |
| `memory.ts`: imports `@ai-sdk/openai-compatible`, builds model instances        | `memory.ts`: no AI SDK dependency, pure persistence + schema logic        |
| `conversation.ts`: passes config credentials to memory layer to build model     | `conversation.ts`: builds model itself, passes instance down              |
| `schemas/` at project root, imported via fragile `../../../` paths              | Schemas inside `src/providers/{kaneo,youtrack}/schemas/` — self-contained |
| Kaneo provisioning logic duplicated in `bot.ts` + `commands/admin.ts`           | Single `provisionAndConfigure()` entry point in `provision.ts`            |
