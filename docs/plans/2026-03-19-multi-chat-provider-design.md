# Multi-Chat Provider Support Design

**Date:** 2026-03-19
**Status:** Approved
**Target providers:** Telegram (existing), Mattermost (new)
**Deployment model:** Single provider per deployment (configured via env var)

## 1. ChatProvider Interface

New abstraction in `src/chat/types.ts`, mirroring the existing `TaskProvider` pattern.

```typescript
/** Identity extracted from an incoming message. */
type ChatUser = {
  id: string
  username: string | null
}

/** A file to send to the user. */
type ChatFile = {
  content: Buffer | string
  filename: string
}

/** Incoming message from a user. */
type IncomingMessage = {
  user: ChatUser
  text: string
  commandMatch?: string
}

/** Command handler signature. */
type CommandHandler = (msg: IncomingMessage, reply: ReplyFn) => Promise<void>

/** Reply function injected into handlers. */
type ReplyFn = {
  text: (content: string) => Promise<void>
  formatted: (markdown: string) => Promise<void>
  file: (file: ChatFile) => Promise<void>
  typing: () => void
}

interface ChatProvider {
  readonly name: string

  registerCommand(name: string, handler: CommandHandler): void
  onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void
  sendMessage(userId: string, markdown: string): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>
}
```

Key decisions:

- **`ReplyFn` instead of raw `ctx`** — commands and message handlers receive a reply object. No platform context leaks.
- **`ChatUser.id` is always a string** — Telegram numeric IDs stored as strings, Mattermost string IDs as-is.
- **No `formatMarkdown` on the interface** — formatting is an internal concern of each adapter's `reply.formatted()` implementation.
- **`commandMatch`** replaces Grammy's `ctx.match` — the argument text after the command name.
- **`sendMessage` takes markdown** — each adapter formats internally (Telegram converts to entities, Mattermost passes through).

## 2. Directory Structure

```
src/
├── chat/
│   ├── types.ts              # ChatProvider, ChatUser, ReplyFn, IncomingMessage, etc.
│   ├── registry.ts           # createChatProvider(name) factory
│   ├── telegram/
│   │   ├── index.ts          # TelegramChatProvider implements ChatProvider
│   │   └── format.ts         # moved from src/utils/format.ts
│   └── mattermost/
│       └── index.ts          # MattermostChatProvider implements ChatProvider
├── bot.ts                    # platform-agnostic orchestration
├── commands/                 # handlers use ReplyFn + IncomingMessage
├── index.ts                  # reads CHAT_PROVIDER env, creates provider, wires everything
└── ...                       # tools/, providers/, config, cache, etc. — unchanged
```

### Module boundary changes

- **`src/index.ts`** — `TELEGRAM_BOT_TOKEN` / `TELEGRAM_USER_ID` replaced by required `CHAT_PROVIDER` + `ADMIN_USER_ID`. Platform-specific env vars validated inside each adapter's constructor.
- **`src/bot.ts`** — no longer imports Grammy. Receives `ChatProvider`. Exports `setupBot(chat, adminUserId)`.
- **`src/commands/*.ts`** — take `ChatProvider` instead of `Bot`. Handlers receive `(msg, reply)` instead of Grammy `ctx`.
- **`src/users.ts`** — `telegram_id` → `platform_user_id` (text). All functions accept string IDs.
- **`src/announcements.ts`** — `BotApi` replaced by `ChatProvider.sendMessage()`.
- **`src/utils/format.ts`** — moved to `src/chat/telegram/format.ts`.

## 3. Command Handler Refactoring

**Before (Telegram-coupled):**

```typescript
export function registerHelpCommand(
  bot: Bot,
  checkAuthorization: (userId: number | undefined, username?: string) => userId is number,
  adminUserId: number,
): void {
  bot.command('help', async (ctx) => {
    const userId = ctx.from?.id
    if (!checkAuthorization(userId, ctx.from?.username)) return
    await ctx.reply(helpText)
  })
}
```

**After (platform-agnostic):**

```typescript
export function registerHelpCommand(
  chat: ChatProvider,
  checkAuthorization: (userId: string, username?: string | null) => boolean,
  adminUserId: string,
): void {
  chat.registerCommand('help', async (msg, reply) => {
    if (!checkAuthorization(msg.user.id, msg.user.username)) return
    await reply.text(helpText)
  })
}
```

Changes across all commands:

| Before (Grammy)                             | After (ChatProvider)                          |
| ------------------------------------------- | --------------------------------------------- |
| `Bot` param                                 | `ChatProvider` param                          |
| `ctx.from?.id`                              | `msg.user.id` (string, never undefined)       |
| `ctx.from?.username`                        | `msg.user.username`                           |
| `ctx.match`                                 | `msg.commandMatch`                            |
| `ctx.reply(text)`                           | `reply.text(text)`                            |
| `ctx.reply(text, { entities })`             | `reply.formatted(markdown)`                   |
| `ctx.replyWithDocument(new InputFile(...))` | `reply.file({ content, filename })`           |
| `bot.api.setMyCommands()`                   | Moved inside TelegramChatProvider             |
| `withTypingIndicator(ctx, fn)`              | `reply.typing()` (adapter handles re-sending) |

## 4. User Identity Migration

**Schema change:**

```sql
-- Current
CREATE TABLE users (
  telegram_id INTEGER PRIMARY KEY,
  username TEXT,
  added_at TEXT NOT NULL,
  added_by INTEGER NOT NULL
)

-- New
CREATE TABLE users (
  platform_user_id TEXT PRIMARY KEY,
  username TEXT,
  added_at TEXT NOT NULL,
  added_by TEXT NOT NULL
)
```

SQLite migration copies existing rows, casting `telegram_id` to text. Same for `user_config` and `conversation_history` tables that reference user IDs.

**Function signature changes in `src/users.ts`:**

- `addUser(userId: string, addedBy: string, username?: string): void`
- `removeUser(identifier: string): void`
- `isAuthorized(userId: string): boolean`
- `resolveUserByUsername(userId: string, username: string): boolean`
- `getKaneoWorkspace(userId: string): string | null`
- `setKaneoWorkspace(userId: string, workspaceId: string): void`

All other modules (`config.ts`, `history.ts`, `cache.ts`, `memory.ts`) change `userId: number` to `userId: string`.

**Environment variables:**

- `ADMIN_USER_ID` (string) replaces `TELEGRAM_USER_ID`
- `CHAT_PROVIDER` (required, no default) — `telegram` or `mattermost`

**Kaneo provisioning:**

`provisionKaneoUser` receives `(baseUrl, publicUrl, platformUserId: string, username: string | null)`. Email: `${username ?? platformUserId}@pap.ai`, slug: `papai-${platformUserId}`.

## 5. Mattermost Adapter

`MattermostChatProvider` in `src/chat/mattermost/index.ts`.

**Connection model:** REST API + WebSocket (no framework dependency).

**Env vars:** `MATTERMOST_URL`, `MATTERMOST_BOT_TOKEN` (validated in constructor).

| Concern              | Telegram adapter                                  | Mattermost adapter                      |
| -------------------- | ------------------------------------------------- | --------------------------------------- |
| Message receiving    | Grammy polling                                    | WebSocket `posted` events               |
| Sending messages     | `ctx.reply(text, { entities })`                   | `POST /api/v4/posts` with markdown body |
| Typing indicator     | `replyWithChatAction('typing')` every 4.5s        | `POST /api/v4/users/{id}/typing`        |
| File upload          | `InputFile`                                       | `POST /api/v4/files` + attach to post   |
| Command registration | `bot.command()` + `setMyCommands()`               | Bot-side parsing of `/command` prefix   |
| User identity        | `ctx.from.id` (numeric)                           | `event.data.post.user_id` (string)      |
| Markdown formatting  | Convert to `MessageEntity[]` via `@gramio/format` | Pass through as-is                      |
| Command arguments    | Grammy's `ctx.match`                              | Parse text after command name           |

## 6. bot.ts Refactoring

**Current:** Creates Grammy Bot, defines all handlers, exports `bot`.
**After:** Pure orchestration module. Exports `setupBot(chat: ChatProvider, adminUserId: string): void`.

What moves out:

- `new Bot(...)` → `TelegramChatProvider` constructor
- `withTypingIndicator()` → Telegram adapter internals
- `formatLlmOutput()` import → each adapter's `reply.formatted()`
- `bot.on('message:text', ...)` → `chat.onMessage(...)`

What stays:

- `buildSystemPrompt()`, `buildOpenAI()`, `buildProvider()`, `getOrCreateTools()`
- `checkAuthorization()` (string IDs)
- `callLlm()`, `processMessage()`, `handleMessageError()`, `maybeProvisionKaneo()` — take `ReplyFn` instead of `ctx`
- `persistFactsFromResults()` — unchanged

**Entry point:**

```typescript
// src/index.ts
const REQUIRED_ENV_VARS = ['CHAT_PROVIDER', 'ADMIN_USER_ID'] as const
// ... validate all present ...
const chatProvider = createChatProvider(process.env['CHAT_PROVIDER']!)
setupBot(chatProvider, process.env['ADMIN_USER_ID']!)
await chatProvider.start()
```

## 7. Announcements & System Prompt

**Announcements:** `BotApi` type removed. `announceNewVersion` receives `ChatProvider`:

```typescript
export async function announceNewVersion(chat: ChatProvider): Promise<void> {
  // ...
  for (const userId of userIds) {
    await chat.sendMessage(userId, markdownMessage)
  }
}
```

**System prompt:** Remove "from Telegram" reference:

```
You are papai, a personal assistant that helps the user manage their tasks.
```

Rest of prompt (workflow, ambiguity rules, destructive actions, output rules) is platform-agnostic, unchanged.

## Unchanged Layers

The following require zero changes:

- `src/tools/` — all tool definitions and schemas
- `src/providers/` — TaskProvider interface and all implementations (Kaneo, YouTrack)
- `src/errors.ts` — error types
- `src/conversation.ts` — conversation history management
- `src/db/` — database layer (except migration for column rename)
