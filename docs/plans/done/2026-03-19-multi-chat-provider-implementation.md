# Multi-Chat Provider Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Decouple papai from Telegram/Grammy so it can run against Telegram or Mattermost via a single `CHAT_PROVIDER` env var.

**Architecture:** Introduce a `ChatProvider` interface (mirroring the existing `TaskProvider` pattern). Extract all Grammy code into a `TelegramChatProvider` adapter. Refactor `bot.ts` and all commands to use the new abstraction. Migrate the DB schema from `telegram_id INTEGER` to `platform_user_id TEXT`. Build a `MattermostChatProvider` using REST + WebSocket.

**Tech Stack:** TypeScript, Bun, Grammy (Telegram adapter only), Mattermost REST API v4 + WebSocket

---

### Task 1: ChatProvider Interface & Registry

**Files:**

- Create: `src/chat/types.ts`
- Create: `src/chat/registry.ts`

**Step 1: Create `src/chat/types.ts`**

```typescript
/** Identity extracted from an incoming message. */
export type ChatUser = {
  id: string
  username: string | null
}

/** A file to send to the user. */
export type ChatFile = {
  content: Buffer | string
  filename: string
}

/** Incoming message from a user. */
export type IncomingMessage = {
  user: ChatUser
  text: string
  commandMatch?: string
}

/** Command handler signature. */
export type CommandHandler = (msg: IncomingMessage, reply: ReplyFn) => Promise<void>

/** Reply function injected into handlers — the only way to send messages back to the user. */
export type ReplyFn = {
  text: (content: string) => Promise<void>
  formatted: (markdown: string) => Promise<void>
  file: (file: ChatFile) => Promise<void>
  typing: () => void
}

/** The core interface every chat platform provider must implement. */
export interface ChatProvider {
  readonly name: string

  /** Register a slash command handler (e.g., 'help' for /help). */
  registerCommand(name: string, handler: CommandHandler): void

  /** Register the catch-all handler for non-command messages. */
  onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void

  /** Send a formatted markdown message to a user by ID (for announcements). */
  sendMessage(userId: string, markdown: string): Promise<void>

  /** Start the bot event loop. */
  start(): Promise<void>

  /** Graceful shutdown. */
  stop(): Promise<void>
}
```

**Step 2: Create `src/chat/registry.ts`**

```typescript
import { logger } from '../logger.js'
import type { ChatProvider } from './types.js'

const log = logger.child({ scope: 'chat:registry' })

type ChatProviderFactory = () => ChatProvider

const providers = new Map<string, ChatProviderFactory>()

export function registerChatProvider(name: string, factory: ChatProviderFactory): void {
  providers.set(name, factory)
}

export function createChatProvider(name: string): ChatProvider {
  const factory = providers.get(name)
  if (factory === undefined) {
    log.error({ name }, 'Unknown chat provider requested')
    throw new Error(`Unknown chat provider: ${name}. Available: ${[...providers.keys()].join(', ')}`)
  }
  log.debug({ name }, 'Creating chat provider instance')
  return factory()
}
```

**Step 3: Verify typecheck passes**

Run: `bun run typecheck`
Expected: PASS (new files are standalone, no imports from existing code yet except logger)

**Step 4: Commit**

```bash
git add src/chat/types.ts src/chat/registry.ts
git commit -m "feat: add ChatProvider interface and registry"
```

---

### Task 2: DB Migration — `telegram_id` to `platform_user_id`

**Files:**

- Create: `src/db/migrations/007_platform_user_id.ts`
- Modify: `src/db/index.ts` — add migration to the list

**Step 1: Read `src/db/index.ts`** to see the migration registration pattern.

**Step 2: Create `src/db/migrations/007_platform_user_id.ts`**

```typescript
import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration007PlatformUserId: Migration = {
  id: '007_platform_user_id',
  up(db: Database): void {
    // --- users table ---
    db.run(`CREATE TABLE users_new (
      platform_user_id TEXT PRIMARY KEY,
      username TEXT UNIQUE,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      added_by TEXT NOT NULL,
      kaneo_workspace_id TEXT
    )`)
    db.run(`INSERT INTO users_new (platform_user_id, username, added_at, added_by, kaneo_workspace_id)
      SELECT CAST(telegram_id AS TEXT), username, added_at, CAST(added_by AS TEXT), kaneo_workspace_id
      FROM users`)
    db.run('DROP TABLE users')
    db.run('ALTER TABLE users_new RENAME TO users')

    // --- user_config table ---
    db.run(`CREATE TABLE user_config_new (
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (user_id, key)
    )`)
    db.run(`INSERT INTO user_config_new (user_id, key, value)
      SELECT CAST(user_id AS TEXT), key, value FROM user_config`)
    db.run('DROP TABLE user_config')
    db.run('ALTER TABLE user_config_new RENAME TO user_config')
    db.run('CREATE INDEX IF NOT EXISTS idx_user_config_user_id ON user_config(user_id)')

    // --- conversation_history table ---
    db.run(`CREATE TABLE conversation_history_new (
      user_id TEXT PRIMARY KEY,
      messages TEXT NOT NULL
    )`)
    db.run(`INSERT INTO conversation_history_new (user_id, messages)
      SELECT CAST(user_id AS TEXT), messages FROM conversation_history`)
    db.run('DROP TABLE conversation_history')
    db.run('ALTER TABLE conversation_history_new RENAME TO conversation_history')

    // --- memory_summary table ---
    db.run(`CREATE TABLE memory_summary_new (
      user_id TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`)
    db.run(`INSERT INTO memory_summary_new (user_id, summary, updated_at)
      SELECT CAST(user_id AS TEXT), summary, updated_at FROM memory_summary`)
    db.run('DROP TABLE memory_summary')
    db.run('ALTER TABLE memory_summary_new RENAME TO memory_summary')

    // --- memory_facts table ---
    db.run(`CREATE TABLE memory_facts_new (
      user_id TEXT NOT NULL,
      identifier TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '',
      last_seen TEXT NOT NULL,
      PRIMARY KEY (user_id, identifier)
    )`)
    db.run(`INSERT INTO memory_facts_new (user_id, identifier, title, url, last_seen)
      SELECT CAST(user_id AS TEXT), identifier, title, url, last_seen FROM memory_facts`)
    db.run('DROP TABLE memory_facts')
    db.run('ALTER TABLE memory_facts_new RENAME TO memory_facts')
    db.run('CREATE INDEX IF NOT EXISTS idx_memory_facts_user_lastseen ON memory_facts(user_id, last_seen DESC)')
  },
}
```

**Step 3: Register the migration in `src/db/index.ts`**

Add the import and append to the migrations array.

**Step 4: Run the migration**

Run: `bun run start` (or a one-off script) to verify migration runs without errors on an existing DB. Alternatively, delete `papai.db` and start fresh.

**Step 5: Commit**

```bash
git add src/db/migrations/007_platform_user_id.ts src/db/index.ts
git commit -m "feat: migrate user ID columns from integer to text"
```

---

### Task 3: Refactor `src/users.ts` — String User IDs

**Files:**

- Modify: `src/users.ts`
- Modify: `tests/users.test.ts`

**Step 1: Update `src/users.ts`**

Change every function signature from `number` to `string` for user IDs. Update all SQL queries from `telegram_id` to `platform_user_id`. Update `UserRecord` type.

```typescript
interface UserRecord {
  platform_user_id: string
  username: string | null
  added_at: string
  added_by: string
}

export function addUser(userId: string, addedBy: string, username?: string): void {
  // SQL: INSERT INTO users (platform_user_id, ...) VALUES (?, ...)
  // ON CONFLICT(platform_user_id) DO UPDATE SET username = excluded.username
}

export function removeUser(identifier: string): void {
  // Try username first, then platform_user_id
  // SQL: DELETE FROM users WHERE username = ? OR platform_user_id = ?
}

export function isAuthorized(userId: string): boolean {
  // SQL: SELECT platform_user_id FROM users WHERE platform_user_id = ?
}

export function resolveUserByUsername(userId: string, username: string): boolean {
  // SQL: SELECT platform_user_id FROM users WHERE username = ?
  // UPDATE users SET platform_user_id = ? WHERE username = ?
}

export function listUsers(): UserRecord[] {
  // SQL: SELECT platform_user_id, username, added_at, added_by FROM users
}

export function getKaneoWorkspace(userId: string): string | null {
  // Uses getCachedWorkspace(userId)
}

export function setKaneoWorkspace(userId: string, workspaceId: string): void {
  // Uses setCachedWorkspace(userId, workspaceId)
}
```

**Step 2: Update `tests/users.test.ts`**

Change all test calls to use string IDs (e.g., `addUser('123', '456')` instead of `addUser(123, 456)`). Update assertions on `UserRecord` fields.

**Step 3: Run tests**

Run: `bun run test -- tests/users.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/users.ts tests/users.test.ts
git commit -m "refactor: change user IDs from number to string in users module"
```

---

### Task 4: Refactor `src/cache.ts` and `src/cache-db.ts` — String User IDs

**Files:**

- Modify: `src/cache.ts` — change `Map<number, UserCache>` to `Map<string, UserCache>`, update all function signatures
- Modify: `src/cache-db.ts` — change all `userId: number` params to `userId: string`, update SQL (`telegram_id` → `platform_user_id`)

**Step 1: Update `src/cache.ts`**

- `const userCaches = new Map<string, UserCache>()` (line 22)
- Every exported function: `userId: number` → `userId: string`
- DB queries: change `[number]` bind types to `[string]`, `telegram_id` → `platform_user_id`
- `getCachedWorkspace`: SQL `SELECT kaneo_workspace_id FROM users WHERE platform_user_id = ?`

**Step 2: Update `src/cache-db.ts`**

- Every function: `userId: number` → `userId: string`
- `syncWorkspaceToDb`: SQL `UPDATE users SET kaneo_workspace_id = ? WHERE platform_user_id = ?`

**Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: Errors in callers (`config.ts`, `history.ts`, `memory.ts`, `conversation.ts`, `bot.ts`, commands) — expected, will fix in subsequent tasks.

**Step 4: Commit**

```bash
git add src/cache.ts src/cache-db.ts
git commit -m "refactor: change user IDs from number to string in cache layer"
```

---

### Task 5: Refactor `src/config.ts`, `src/history.ts`, `src/memory.ts`, `src/conversation.ts` — String User IDs

**Files:**

- Modify: `src/config.ts` — `userId: number` → `userId: string` in all functions
- Modify: `src/history.ts` — same
- Modify: `src/memory.ts` — same
- Modify: `src/conversation.ts` — same
- Modify: `tests/config.test.ts`, `tests/history.test.ts`, `tests/memory.test.ts` — use string IDs in tests

**Step 1: Update all four source files**

Each file: change every `userId: number` parameter to `userId: string`. No SQL changes needed (these modules delegate to cache layer).

**Step 2: Update tests**

Change numeric user IDs to string equivalents in all test calls.

**Step 3: Run tests**

Run: `bun run test -- tests/config.test.ts tests/history.test.ts tests/memory.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/config.ts src/history.ts src/memory.ts src/conversation.ts tests/config.test.ts tests/history.test.ts tests/memory.test.ts
git commit -m "refactor: change user IDs from number to string in config, history, memory, conversation"
```

---

### Task 6: Refactor `src/announcements.ts` — Use ChatProvider

**Files:**

- Modify: `src/announcements.ts`
- Modify: `tests/announcements.test.ts`

**Step 1: Update `src/announcements.ts`**

- Remove `import type { MessageEntity } from '@grammyjs/types'`
- Remove `BotApi` type
- Remove `formatLlmOutput` import
- Change `announceNewVersion(botInstance: BotApi)` → `announceNewVersion(chat: ChatProvider)`
- Change `getUsersWithKaneoAccount()` return from `number[]` → `string[]`
- `sendAnnouncementsToUsers`: iterate userIds and call `chat.sendMessage(userId, markdownMessage)` (the adapter handles formatting)

```typescript
import type { ChatProvider } from './chat/types.js'

// ...

function getUsersWithKaneoAccount(): string[] {
  return getDb()
    .query<{ user_id: string }, [string]>('SELECT DISTINCT user_id FROM user_config WHERE key = ?')
    .all('kaneo_apikey')
    .map((row) => row.user_id)
}

async function sendAnnouncementsToUsers(userIds: string[], markdown: string, chat: ChatProvider): Promise<number> {
  const results = await Promise.allSettled(
    userIds.map(async (userId) => {
      try {
        await chat.sendMessage(userId, markdown)
        log.debug({ userId, version: VERSION }, 'Announcement sent to user')
        return true
      } catch (error) {
        log.warn(
          { userId, version: VERSION, error: error instanceof Error ? error.message : String(error) },
          'Failed to send announcement to user',
        )
        return false
      }
    }),
  )
  return results.filter((r) => r.status === 'fulfilled' && r.value).length
}

export async function announceNewVersion(chat: ChatProvider): Promise<void> {
  // ... same logic, pass chat instead of botInstance
  const message = `🆕 papai v${VERSION} has been released!\n\n${changelogSection}`
  const successCount = await sendAnnouncementsToUsers(users, message, chat)
  // ...
}
```

**Step 2: Update `tests/announcements.test.ts`**

Replace `BotApi` mock with a `ChatProvider` mock that implements `sendMessage`.

**Step 3: Run tests**

Run: `bun run test -- tests/announcements.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/announcements.ts tests/announcements.test.ts
git commit -m "refactor: announcements use ChatProvider instead of Grammy BotApi"
```

---

### Task 7: Refactor `src/providers/kaneo/provision.ts` — String User IDs

**Files:**

- Modify: `src/providers/kaneo/provision.ts`

**Step 1: Update `provisionKaneoUser` signature**

```typescript
export async function provisionKaneoUser(
  baseUrl: string,
  publicUrl: string,
  platformUserId: string,
  username: string | null,
): Promise<ProvisionResult> {
  const email = username === null ? `${platformUserId}@pap.ai` : `${username}@pap.ai`
  const password = generatePassword()
  const name = username === null ? `User ${platformUserId}` : `@${username}`
  const slug = `papai-${platformUserId}`

  log.info({ platformUserId, email }, 'Provisioning Kaneo user account')
  // ... rest unchanged, replace telegramId references with platformUserId in logs
}
```

**Step 2: Update `provisionAndConfigure` signature**

> **Gap vs original plan:** `provisionAndConfigure` was not in the original plan but is also exported from this file and takes `userId: number`. It calls `setConfig`, `setKaneoWorkspace`, and `clearCachedTools` — all of which become `string` after Tasks 3–5.

```typescript
export async function provisionAndConfigure(userId: string, username: string | null): Promise<ProvisionOutcome> {
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
    // ... same error handling unchanged
  }
}
```

**Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: Callers (`llm-orchestrator.ts`, `admin.ts`) will error — fixed in later tasks.

**Step 4: Commit**

```bash
git add src/providers/kaneo/provision.ts
git commit -m "refactor: kaneo provisioning uses string platform user ID"
```

---

### Task 8: Move `src/utils/format.ts` → `src/chat/telegram/format.ts`

**Files:**

- Move: `src/utils/format.ts` → `src/chat/telegram/format.ts`
- Modify: any file that imports from `../utils/format.js` — after this task only the Telegram adapter should import it

**Step 1: Create `src/chat/telegram/format.ts`** with the exact contents of `src/utils/format.ts`

**Step 2: Delete `src/utils/format.ts`**

**Step 3: Update imports**

Currently imported by:

- `src/llm-orchestrator.ts` — update to `./chat/telegram/format.js` (will be removed entirely in Task 10a)
- `src/announcements.ts` — already removed in Task 6
- `tests/utils/format.test.ts` — update import path to `../../src/chat/telegram/format.js`

> **Gap vs original plan:** The plan referenced `src/bot.ts` as the importer. Since the plan was written, LLM orchestration was extracted to `src/llm-orchestrator.ts`, which is now the actual importer.

**Step 4: Run tests**

Run: `bun run test -- tests/utils/format.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/chat/telegram/format.ts tests/utils/format.test.ts
git rm src/utils/format.ts
git commit -m "refactor: move format.ts into telegram adapter directory"
```

---

### Task 9: Refactor Command Handlers — Platform-Agnostic

**Files:**

- Modify: `src/commands/help.ts`
- Modify: `src/commands/set.ts`
- Modify: `src/commands/config.ts`
- Modify: `src/commands/clear.ts`
- Modify: `src/commands/context.ts`
- Modify: `src/commands/admin.ts`
- Modify: `src/commands/index.ts`

**Step 1: Update `src/commands/help.ts`**

```typescript
import type { ChatProvider } from '../chat/types.js'
import { logger } from '../logger.js'

// ... USER_COMMANDS, ADMIN_COMMANDS, USER_HELP, ADMIN_HELP stay the same ...

export function registerHelpCommand(
  chat: ChatProvider,
  checkAuthorization: (userId: string, username?: string | null) => boolean,
  adminUserId: string,
): void {
  chat.registerCommand('help', async (msg, reply) => {
    if (!checkAuthorization(msg.user.id, msg.user.username)) return
    log.info({ userId: msg.user.id }, '/help command executed')
    const text = msg.user.id === adminUserId ? USER_HELP + ADMIN_HELP : USER_HELP
    await reply.text(text)
  })
}

// setCommands is Telegram-specific — move into TelegramChatProvider (Task 10)
```

**Step 2: Update `src/commands/set.ts`**

```typescript
import type { ChatProvider } from '../chat/types.js'

export function registerSetCommand(
  chat: ChatProvider,
  checkAuthorization: (userId: string, username?: string | null) => boolean,
): void {
  chat.registerCommand('set', async (msg, reply) => {
    if (!checkAuthorization(msg.user.id, msg.user.username)) return
    const match = (msg.commandMatch ?? '').trim()
    const spaceIndex = match.indexOf(' ')
    if (spaceIndex === -1) {
      await reply.text(`Usage: /set <key> <value>\nValid keys: ${CONFIG_KEYS.join(', ')}`)
      return
    }
    const key = match.slice(0, spaceIndex).trim()
    const value = match.slice(spaceIndex + 1).trim()
    if (!isConfigKey(key)) {
      await reply.text(`Unknown key: ${key}\nValid keys: ${CONFIG_KEYS.join(', ')}`)
      return
    }
    setConfig(msg.user.id, key, value)
    log.info({ userId: msg.user.id, key }, '/set command executed')
    await reply.text(`Set ${key} successfully.`)
  })
}
```

**Step 3: Update `src/commands/config.ts`**

Same pattern: `ChatProvider`, `(msg, reply)`, `msg.user.id`, `reply.text()`.

**Step 4: Update `src/commands/clear.ts`**

Same pattern. For the `clear all` branch, `listUsers()` returns `UserRecord[]` with `platform_user_id: string`. Replace `user.telegram_id` with `user.platform_user_id`. The `/clear <user_id>` branch: remove `parseInt` — user IDs are already strings.

**Step 5: Update `src/commands/context.ts`**

```typescript
import type { ChatProvider } from '../chat/types.js'
// Remove Grammy imports (InputFile, Bot)

export function registerContextCommand(chat: ChatProvider, adminUserId: string): void {
  chat.registerCommand('context', async (msg, reply) => {
    if (msg.user.id !== adminUserId) {
      await reply.text('Only the admin can use this command.')
      return
    }
    // ... same logic to build report ...
    await reply.file({ content: Buffer.from(report, 'utf-8'), filename: 'context.txt' })
  })
}
```

**Step 6: Update `src/commands/admin.ts`**

```typescript
import type { ChatProvider, IncomingMessage, ReplyFn } from '../chat/types.js'

// parseUserIdentifier: change return from { type: 'id'; value: number } to { type: 'id'; value: string }
// Remove parseInt logic — IDs are strings now

export function registerAdminCommands(chat: ChatProvider, adminUserId: string): void {
  const checkAdmin = (userId: string): boolean => userId === adminUserId

  chat.registerCommand('user', async (msg, reply) => {
    if (!checkAdmin(msg.user.id)) {
      await reply.text('Only the admin can manage users.')
      return
    }
    await handleUserCommand(msg, reply, msg.user.id, adminUserId)
  })

  chat.registerCommand('users', async (msg, reply) => {
    if (!checkAdmin(msg.user.id)) {
      await reply.text('Only the admin can list users.')
      return
    }
    await handleUsersCommand(reply, msg.user.id, adminUserId)
  })
}
```

All inner functions (`handleUserCommand`, `handleUsersCommand`, `handleUserAdd`, `handleUserRemove`, `provisionUserKaneo`) change from `ctx` to `(reply: ReplyFn)` and use `reply.text()` instead of `ctx.reply()`. User references change from `user.telegram_id` to `user.platform_user_id`.

The `placeholderId` for username-only users (currently `-Math.floor(...)`) becomes a string placeholder: `placeholder-${crypto.randomUUID()}`.

**Step 7: Update `src/commands/index.ts`**

Remove `setCommands` export (moved to Telegram adapter). Keep all `register*` exports.

**Step 8: Run typecheck**

Run: `bun run typecheck`
Expected: Errors in `bot.ts` and `index.ts` (callers) — fixed in next tasks.

**Step 9: Commit**

```bash
git add src/commands/
git commit -m "refactor: command handlers use ChatProvider abstraction"
```

---

### Task 10a: Refactor `src/llm-orchestrator.ts` — Remove Grammy Context

> **Gap vs original plan:** Since the plan was written, all LLM orchestration logic was extracted from `bot.ts` into `src/llm-orchestrator.ts`. This is now the primary refactoring target — `bot.ts` itself is a thin wiring file. This task was entirely missing from the original plan.

**Files:**

- Modify: `src/llm-orchestrator.ts`

**Step 1: Remove Grammy import, replace `Context` with `ReplyFn`**

- Remove: `import type { Context } from 'grammy'`
- Remove: `import { formatLlmOutput } from './chat/telegram/format.js'` (already moved in Task 8; formatting is now `reply.formatted()`)
- Add: `import type { ReplyFn } from './chat/types.js'`

**Step 2: Update all function signatures — `number` → `string`, `Context` → `ReplyFn`**

```typescript
// userId: number → string throughout
const checkRequiredConfig = (userId: string): string[] => { ... }
const persistFactsFromResults = (userId: string, ...): void => { ... }
const buildProvider = (userId: string): TaskProvider => { ... }
const getOrCreateTools = (userId: string, provider: TaskProvider): ToolSet => { ... }

// ctx: Context → reply: ReplyFn
const sendLlmResponse = async (
  reply: ReplyFn,
  userId: string,
  result: { text?: string; toolCalls?: unknown[]; response: { messages: ModelMessage[] } },
): Promise<void> => {
  const textToFormat = result.text !== undefined && result.text !== '' ? result.text : 'Done.'
  await reply.formatted(textToFormat)
  log.info({ userId, responseLength: result.text?.length ?? 0, toolCalls: result.toolCalls?.length ?? 0 }, 'Response sent successfully')
}

const maybeProvisionKaneo = async (reply: ReplyFn, userId: string, username: string | null): Promise<void> => {
  if (getKaneoWorkspace(userId) !== null && getConfig(userId, 'kaneo_apikey') !== null) return
  const outcome = await provisionAndConfigure(userId, username)
  if (outcome.status === 'provisioned') {
    await reply.text(
      `✅ Your Kaneo account has been created!\n🌐 ${outcome.kaneoUrl}\n📧 Email: ${outcome.email}\n🔑 Password: ${outcome.password}\n\nThe bot is already configured and ready to use.`,
    )
  } else if (outcome.status === 'registration_disabled') {
    await reply.text('Kaneo account could not be created — registration is currently disabled on this instance.\n\nPlease ask the admin to provision your account.')
  }
}

const callLlm = async (
  reply: ReplyFn,
  userId: string,
  username: string | null,
  history: readonly ModelMessage[],
): Promise<{ response: { messages: ModelMessage[] } }> => {
  await maybeProvisionKaneo(reply, userId, username)
  const missing = checkRequiredConfig(userId)
  if (missing.length > 0) {
    log.warn({ userId, missing }, 'Missing required config keys')
    await reply.text(`Missing configuration: ${missing.join(', ')}.\nUse /set <key> <value> to configure.`)
    throw new Error('Missing configuration')
  }
  // ... rest unchanged
  await sendLlmResponse(reply, userId, result)
  return result
}

const handleMessageError = async (reply: ReplyFn, _userId: string, error: unknown): Promise<void> => {
  if (isAppError(error)) {
    await reply.text(getUserMessage(error))
  } else {
    await reply.text('An unexpected error occurred. Please try again later.')
  }
}

export const processMessage = async (reply: ReplyFn, userId: string, username: string | null, userText: string): Promise<void> => {
  // ... same logic, pass (reply, userId, username, history) to callLlm
}
```

**Step 3: Remove `withTypingIndicator`** — it has moved into `TelegramChatProvider` (Task 11). The Telegram adapter's `onMessage` handler wraps the call in its own typing loop; `processMessage` no longer needs it.

**Step 4: Update `BASE_SYSTEM_PROMPT`** — remove "directly from Telegram":

```typescript
const BASE_SYSTEM_PROMPT = `You are papai, a personal assistant that helps the user manage their tasks.
Current date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.
...`
```

**Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: Errors in `src/bot.ts` (still wires `ctx` through) — fixed in Task 10.

**Step 6: Commit**

```bash
git add src/llm-orchestrator.ts
git commit -m "refactor: llm-orchestrator uses ReplyFn and string user IDs"
```

---

### Task 10: Refactor `src/bot.ts` — Platform-Agnostic Wiring

> **Updated vs original plan:** `bot.ts` is now a thin wiring module (all orchestration is in `llm-orchestrator.ts`). The refactoring here is minimal: remove Grammy, export `setupBot()`.

**Files:**

- Modify: `src/bot.ts`

**Step 1: Rewrite `src/bot.ts`**

Remove all Grammy imports. Export `setupBot(chat: ChatProvider, adminUserId: string): void` instead of `bot`.

```typescript
import type { ChatProvider } from './chat/types.js'
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

const checkAuthorization = (userId: string, username?: string | null): boolean => {
  log.debug({ userId }, 'Checking authorization')
  if (isAuthorized(userId)) return true
  if (username !== undefined && username !== null && resolveUserByUsername(userId, username)) return true
  log.warn({ attemptedUserId: userId }, 'Unauthorized access attempt')
  return false
}

export function setupBot(chat: ChatProvider, adminUserId: string): void {
  registerHelpCommand(chat, checkAuthorization, adminUserId)
  registerSetCommand(chat, checkAuthorization)
  registerConfigCommand(chat, checkAuthorization)
  registerContextCommand(chat, adminUserId)
  registerClearCommand(chat, checkAuthorization, adminUserId)
  registerAdminCommands(chat, adminUserId)

  chat.onMessage(async (msg, reply) => {
    if (!checkAuthorization(msg.user.id, msg.user.username)) return
    reply.typing()
    await processMessage(reply, msg.user.id, msg.user.username, msg.text)
  })
}
```

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: Errors in `index.ts` (still imports `bot`) and `bot.test.ts` — fixed next.

**Step 3: Commit**

```bash
git add src/bot.ts
git commit -m "refactor: bot.ts uses ChatProvider, exports setupBot()"
```

---

### Task 11: TelegramChatProvider Adapter

**Files:**

- Create: `src/chat/telegram/index.ts`
- Modify: `src/chat/registry.ts` — register Telegram provider

**Step 1: Create `src/chat/telegram/index.ts`**

```typescript
import { Bot, InputFile, type Context } from 'grammy'

import { logger } from '../../logger.js'
import type { ChatProvider, CommandHandler, IncomingMessage, ReplyFn } from '../types.js'
import { formatLlmOutput } from './format.js'

const log = logger.child({ scope: 'chat:telegram' })

export class TelegramChatProvider implements ChatProvider {
  readonly name = 'telegram'
  private readonly bot: Bot
  private readonly commands: Map<string, CommandHandler> = new Map()
  private messageHandler: ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null = null

  constructor() {
    const token = process.env['TELEGRAM_BOT_TOKEN']
    if (token === undefined || token.trim() === '') {
      throw new Error('TELEGRAM_BOT_TOKEN environment variable is required')
    }
    this.bot = new Bot(token)
  }

  registerCommand(name: string, handler: CommandHandler): void {
    this.commands.set(name, handler)
    this.bot.command(name, async (ctx) => {
      const msg = this.extractMessage(ctx)
      if (msg === null) return
      msg.commandMatch = typeof ctx.match === 'string' ? ctx.match : ''
      const reply = this.buildReplyFn(ctx)
      await handler(msg, reply)
    })
  }

  onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void {
    this.messageHandler = handler
    this.bot.on('message:text', async (ctx) => {
      const msg = this.extractMessage(ctx)
      if (msg === null) return
      const reply = this.buildReplyFn(ctx)
      await this.withTypingIndicator(ctx, () => handler(msg, reply))
    })
  }

  async sendMessage(userId: string, markdown: string): Promise<void> {
    const formatted = formatLlmOutput(markdown)
    await this.bot.api.sendMessage(parseInt(userId, 10), formatted.text, {
      entities: formatted.entities,
    })
  }

  async start(): Promise<void> {
    await this.bot.start({
      onStart: () => {
        log.info('Telegram bot is running')
      },
    })
  }

  async stop(): Promise<void> {
    await this.bot.stop()
  }

  /** Set the Telegram command menu (Telegram-specific). */
  async setCommands(adminUserId: string): Promise<void> {
    const userCmds = [
      { command: 'help', description: 'Show available commands' },
      { command: 'set', description: 'Set a config value — /set <key> <value>' },
      { command: 'config', description: 'View current configuration' },
      { command: 'clear', description: 'Clear conversation history and memory' },
    ]
    const adminCmds = [
      ...userCmds,
      { command: 'context', description: 'Show current memory context' },
      { command: 'user', description: 'Manage users — /user add|remove <id|@username>' },
      { command: 'users', description: 'List authorized users' },
    ]
    await this.bot.api.setMyCommands(userCmds, { scope: { type: 'all_private_chats' } })
    await this.bot.api.setMyCommands(adminCmds, {
      scope: { type: 'chat', chat_id: parseInt(adminUserId, 10) },
    })
    log.info({ adminUserId }, 'Telegram command menu registered')
  }

  private extractMessage(ctx: Context): IncomingMessage | null {
    const id = ctx.from?.id
    if (id === undefined) return null
    return {
      user: {
        id: String(id),
        username: ctx.from?.username ?? null,
      },
      text: ctx.message?.text ?? '',
    }
  }

  private buildReplyFn(ctx: Context): ReplyFn {
    return {
      text: async (content: string) => {
        await ctx.reply(content)
      },
      formatted: async (markdown: string) => {
        const formatted = formatLlmOutput(markdown)
        await ctx.reply(formatted.text, { entities: formatted.entities })
      },
      file: async (file) => {
        const content = typeof file.content === 'string' ? Buffer.from(file.content, 'utf-8') : file.content
        await ctx.replyWithDocument(new InputFile(content, file.filename))
      },
      typing: () => {
        ctx.replyWithChatAction('typing').catch(() => undefined)
      },
    }
  }

  private async withTypingIndicator<T>(ctx: Context, fn: () => Promise<T>): Promise<T> {
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
}
```

**Step 2: Register in `src/chat/registry.ts`**

```typescript
import { TelegramChatProvider } from './telegram/index.js'

registerChatProvider('telegram', () => new TelegramChatProvider())
```

**Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS for chat/ directory

**Step 4: Commit**

```bash
git add src/chat/telegram/index.ts src/chat/registry.ts
git commit -m "feat: implement TelegramChatProvider adapter"
```

---

### Task 12: Refactor `src/index.ts` — Wire Everything Together

**Files:**

- Modify: `src/index.ts`
- Modify: `.env.example`

**Step 1: Rewrite `src/index.ts`**

```typescript
import { announceNewVersion } from './announcements.js'
import { setupBot } from './bot.js'
import { createChatProvider } from './chat/registry.js'
import type { TelegramChatProvider } from './chat/telegram/index.js'
import { closeDb, initDb } from './db/index.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'main' })

// KANEO_CLIENT_URL is NOT moved here — it stays as a Kaneo-specific runtime var
// consumed by provisionAndConfigure and buildProvider (not a top-level startup requirement)
const REQUIRED_ENV_VARS = ['CHAT_PROVIDER', 'ADMIN_USER_ID']

const missing = REQUIRED_ENV_VARS.filter((v) => (process.env[v]?.trim() ?? '') === '')
if (missing.length > 0) {
  log.error({ variables: missing }, 'Missing required environment variables')
  process.exit(1)
}

log.info('Starting papai...')

try {
  initDb()
} catch (error) {
  log.error({ error: error instanceof Error ? error.message : String(error) }, 'Database migration failed')
  process.exit(1)
}

const adminUserId = process.env['ADMIN_USER_ID']!
const chatProvider = createChatProvider(process.env['CHAT_PROVIDER']!)

log.info({ adminUserId, chatProvider: process.env['CHAT_PROVIDER'] }, 'Starting papai...')

setupBot(chatProvider, adminUserId)

await chatProvider.start()

// Telegram-specific: register command menu
if ('setCommands' in chatProvider) {
  void (chatProvider as TelegramChatProvider).setCommands(adminUserId)
}

void announceNewVersion(chatProvider)

process.on('SIGINT', () => {
  log.info('SIGINT received, shutting down gracefully')
  void chatProvider.stop()
  closeDb()
  process.exit(0)
})

process.on('SIGTERM', () => {
  log.info('SIGTERM received, shutting down gracefully')
  void chatProvider.stop()
  closeDb()
  process.exit(0)
})
```

**Step 2: Update `.env.example`**

Replace:

```
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
TELEGRAM_USER_ID=123456789
```

With:

```
# Chat provider: telegram or mattermost
CHAT_PROVIDER=telegram

# Admin user ID (platform-specific: numeric for Telegram, string for Mattermost)
ADMIN_USER_ID=123456789

# --- Telegram-specific (required when CHAT_PROVIDER=telegram) ---
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here

# --- Mattermost-specific (required when CHAT_PROVIDER=mattermost) ---
# MATTERMOST_URL=https://mm.example.com
# MATTERMOST_BOT_TOKEN=your_mattermost_bot_token_here

# --- Kaneo-specific (required when using Kaneo task provider) ---
KANEO_CLIENT_URL=http://localhost:3000
```

**Step 3: Run typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS

**Step 4: Commit**

```bash
git add src/index.ts .env.example
git commit -m "refactor: index.ts uses ChatProvider, new env vars"
```

---

### Task 13: Update Tests for Refactored Modules

**Files:**

- Modify: `tests/bot.test.ts` — mock `ChatProvider` instead of Grammy `Bot`
- Modify: any other test files that reference Grammy types or numeric user IDs

> **Note on `llm-orchestrator.ts` tests:** `tests/bot.test.ts` currently tests the LLM orchestration logic that lives in `llm-orchestrator.ts`. After Tasks 10a and 10, it should mock `ChatProvider` (specifically `ReplyFn`) instead of Grammy `Context`. The mock `processMessage` call signature changes to `(reply, userId, username, text)`.

**Step 1: Update `tests/bot.test.ts`**

Replace Grammy-specific mocking with ChatProvider mocking. The test should verify that `setupBot` registers commands and message handlers correctly, and that `processMessage` (now in `llm-orchestrator.ts`) is called with `(ReplyFn, string userId, string | null username, string text)`.

**Step 2: Run full test suite**

Run: `bun run test`
Expected: PASS

**Step 3: Run typecheck and lint**

Run: `bun run typecheck && bun run lint && bun run knip`
Expected: PASS (knip may flag removed Grammy imports — verify they're truly unused)

**Step 4: Commit**

```bash
git add tests/
git commit -m "test: update tests for ChatProvider abstraction"
```

---

### Task 14: MattermostChatProvider Adapter

**Files:**

- Create: `src/chat/mattermost/index.ts`
- Modify: `src/chat/registry.ts` — register Mattermost provider

**Step 1: Look up Mattermost REST API v4 docs**

Use `context7` to retrieve up-to-date Mattermost API documentation for:

- `POST /api/v4/posts` — create a post
- `POST /api/v4/files` — upload a file
- `POST /api/v4/users/{user_id}/typing` — typing indicator
- WebSocket events at `/api/v4/websocket` — `posted` event format
- `GET /api/v4/users/me` — get bot user info (needed to filter own messages)

**Step 2: Create `src/chat/mattermost/index.ts`**

Implement `MattermostChatProvider`:

- Constructor validates `MATTERMOST_URL` and `MATTERMOST_BOT_TOKEN`
- `start()` opens a WebSocket connection to `${url}/api/v4/websocket`
- WebSocket `posted` events: parse the post JSON, check if it's from the bot (ignore own messages), extract user ID and message text, check for `/command` prefix, dispatch to command handlers or message handler
- `sendMessage()`: `POST /api/v4/posts` with channel ID (for direct messages, need to create/get a DM channel first via `POST /api/v4/channels/direct`)
- `stop()`: close WebSocket
- `reply.formatted()`: post markdown as-is
- `reply.file()`: upload via `POST /api/v4/files` then create post with file ID
- `reply.typing()`: `POST /api/v4/users/{bot_user_id}/typing` with channel_id
- Command parsing: if text starts with `/{registered_command}`, extract match and dispatch

```typescript
import { logger } from '../../logger.js'
import type { ChatProvider, CommandHandler, IncomingMessage, ReplyFn } from '../types.js'

const log = logger.child({ scope: 'chat:mattermost' })

export class MattermostChatProvider implements ChatProvider {
  readonly name = 'mattermost'
  private readonly baseUrl: string
  private readonly token: string
  private readonly commands = new Map<string, CommandHandler>()
  private messageHandler: ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null = null
  private ws: WebSocket | null = null
  private botUserId: string | null = null

  constructor() {
    const url = process.env['MATTERMOST_URL']
    const token = process.env['MATTERMOST_BOT_TOKEN']
    if (url === undefined || url.trim() === '') {
      throw new Error('MATTERMOST_URL environment variable is required')
    }
    if (token === undefined || token.trim() === '') {
      throw new Error('MATTERMOST_BOT_TOKEN environment variable is required')
    }
    this.baseUrl = url.replace(/\/+$/, '')
    this.token = token
  }

  registerCommand(name: string, handler: CommandHandler): void {
    this.commands.set(name, handler)
  }

  onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void {
    this.messageHandler = handler
  }

  async sendMessage(userId: string, markdown: string): Promise<void> {
    const channelId = await this.getOrCreateDirectChannel(userId)
    await this.createPost(channelId, markdown)
  }

  async start(): Promise<void> {
    // Fetch bot user ID
    const me = await this.apiGet('/api/v4/users/me')
    this.botUserId = me.id
    log.info({ botUserId: this.botUserId }, 'Mattermost bot user identified')

    // Open WebSocket
    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/api/v4/websocket'
    this.ws = new WebSocket(wsUrl)

    this.ws.onopen = () => {
      // Authenticate
      this.ws!.send(
        JSON.stringify({
          seq: 1,
          action: 'authentication_challenge',
          data: { token: this.token },
        }),
      )
      log.info('Mattermost WebSocket connected')
    }

    this.ws.onmessage = (event) => {
      void this.handleWsEvent(typeof event.data === 'string' ? event.data : '')
    }

    this.ws.onclose = () => {
      log.warn('Mattermost WebSocket closed')
      // Reconnect logic can be added later
    }

    this.ws.onerror = (event) => {
      log.error({ error: String(event) }, 'Mattermost WebSocket error')
    }
  }

  async stop(): Promise<void> {
    if (this.ws !== null) {
      this.ws.close()
      this.ws = null
    }
  }

  private async handleWsEvent(raw: string): Promise<void> {
    try {
      const event = JSON.parse(raw)
      if (event.event !== 'posted') return
      const post = JSON.parse(event.data.post)
      if (post.user_id === this.botUserId) return // ignore own messages

      const channelId = post.channel_id as string
      const text = (post.message as string).trim()
      const userId = post.user_id as string

      // Look up username
      const user = await this.apiGet(`/api/v4/users/${userId}`)
      const msg: IncomingMessage = {
        user: { id: userId, username: user.username ?? null },
        text,
      }

      const reply = this.buildReplyFn(channelId)

      // Check for commands
      for (const [name, handler] of this.commands) {
        if (text === `/${name}` || text.startsWith(`/${name} `)) {
          msg.commandMatch = text.slice(name.length + 2) // +2 for / and space
          await handler(msg, reply)
          return
        }
      }

      // Regular message
      if (this.messageHandler !== null) {
        await this.messageHandler(msg, reply)
      }
    } catch (error) {
      log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to handle WS event')
    }
  }

  private buildReplyFn(channelId: string): ReplyFn {
    return {
      text: async (content: string) => {
        await this.createPost(channelId, content)
      },
      formatted: async (markdown: string) => {
        await this.createPost(channelId, markdown)
      },
      file: async (file) => {
        const content = typeof file.content === 'string' ? Buffer.from(file.content, 'utf-8') : file.content
        const fileId = await this.uploadFile(channelId, content, file.filename)
        await this.createPost(channelId, '', [fileId])
      },
      typing: () => {
        void this.apiPost(`/api/v4/users/${this.botUserId}/typing`, { channel_id: channelId })
      },
    }
  }

  private async createPost(channelId: string, message: string, fileIds?: string[]): Promise<void> {
    await this.apiPost('/api/v4/posts', {
      channel_id: channelId,
      message,
      ...(fileIds !== undefined ? { file_ids: fileIds } : {}),
    })
  }

  private async uploadFile(channelId: string, content: Buffer, filename: string): Promise<string> {
    const form = new FormData()
    form.append('files', new Blob([content]), filename)
    form.append('channel_id', channelId)
    const res = await fetch(`${this.baseUrl}/api/v4/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      body: form,
    })
    if (!res.ok) throw new Error(`File upload failed: ${res.status}`)
    const data = await res.json()
    return data.file_infos[0].id
  }

  private async getOrCreateDirectChannel(userId: string): Promise<string> {
    const res = await this.apiPost('/api/v4/channels/direct', [this.botUserId, userId])
    return res.id
  }

  private async apiGet(path: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    })
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`)
    return res.json()
  }

  private async apiPost(path: string, body: unknown): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`)
    return res.json()
  }
}
```

**Step 3: Register in `src/chat/registry.ts`**

```typescript
import { MattermostChatProvider } from './mattermost/index.js'

registerChatProvider('mattermost', () => new MattermostChatProvider())
```

**Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/chat/mattermost/index.ts src/chat/registry.ts
git commit -m "feat: implement MattermostChatProvider adapter"
```

---

### Task 15: Update CLAUDE.md and .env.example

**Files:**

- Modify: `CLAUDE.md` — update architecture diagram, env var docs, file descriptions
- Modify: `.env.example` — already done in Task 12

**Step 1: Update `CLAUDE.md`**

- Architecture diagram: add `chat/` layer between Telegram/Mattermost and bot.ts
- Env vars: document `CHAT_PROVIDER`, `ADMIN_USER_ID`, platform-specific vars
- File descriptions: add `src/chat/` entries
- Remove references to `TELEGRAM_BOT_TOKEN` and `TELEGRAM_USER_ID` as top-level required vars

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for multi-chat provider architecture"
```

---

### Task 16: Final Verification

**Step 1: Run full test suite**

Run: `bun run test`
Expected: All tests PASS

**Step 2: Run all checks**

Run: `bun run typecheck && bun run lint && bun run format && bun run knip && bun run security`
Expected: All PASS

**Step 3: Verify Telegram still works end-to-end**

Set `CHAT_PROVIDER=telegram` in `.env`, run `bun run start`, send a test message.

**Step 4: Clean up any dead code**

Run: `bun run knip`
Remove any unused exports, imports, or dependencies flagged by knip.

**Step 5: Final commit if cleanup needed**

```bash
git add -A
git commit -m "chore: clean up dead code after multi-chat provider refactor"
```
