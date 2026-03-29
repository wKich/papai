# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

papai is a chat bot that manages tasks via LLM tool-calling. A user sends natural language messages through a configurable chat platform (Telegram or Mattermost), the bot invokes a configurable OpenAI-compatible LLM (via Vercel AI SDK) which autonomously selects and executes task tracker operations, then replies with the result. The chat platform, task tracker provider (Kaneo, YouTrack, or any future provider), LLM provider, base URL, and model are all runtime-configurable.

## Commands

All scripts can be run with `bun <script>` (no `run` keyword needed):

- `bun start` — run the bot
- `bun lint` — lint with oxlint
- `bun lint:fix` — lint with auto-fix
- `bun format` — format with oxfmt
- `bun format:check` — check formatting without writing
- `bun knip` — check for unused dependencies/exports
- `bun typecheck` — TypeScript type checking
- `bun security` — run Semgrep security scan locally
- `bun security:ci` — run security scan with JSON/SARIF output for CI
- `bun test` — run unit tests (excludes E2E)
- `bun test:watch` — run unit tests in watch mode
- `bun test:coverage` — run unit tests with coverage
- `bun test:e2e` — run E2E tests (requires Docker)
- `bun test:e2e:watch` — run E2E tests in watch mode
- `bun check` — run lint/typecheck/format on staged files only (fast, used by pre-commit hook)
- `bun check:full` — run all checks, suppressing success output
- `bun check:verbose` — run all checks with verbose output (lint, typecheck, format:check, knip, test, duplicates, mock-pollution)
- `bun fix` — auto-fix lint and format issues
- `bun install` — install dependencies

No build step; Bun runs TypeScript directly.

## Testing

**Unit tests** (excludes E2E tests):

```bash
bun test           # or: bun run test
```

**E2E tests** (requires Docker):

```bash
bun test:e2e       # or: bun run test:e2e
```

The `bunfig.toml` is configured with `pathIgnorePatterns` to exclude E2E tests from the default `bun test` command. E2E tests require Docker to spin up a Kaneo instance and must be run separately via `bun test:e2e`.

## Security

- `bun run security` — run Semgrep security scan locally
- `bun run security:ci` — run scan with JSON/SARIF output for CI

Security scans check for:

- OWASP Top 10 vulnerabilities
- TypeScript/JavaScript best practices
- AI/LLM-specific security issues (hardcoded API keys, prompt injection, etc.)

The scan runs automatically in CI on every PR and push to master.

## Required Environment Variables

Copy `.env.example` to `.env`. Required at startup (validated in `src/index.ts`):
`CHAT_PROVIDER`, `ADMIN_USER_ID`, `TASK_PROVIDER`

`ADMIN_USER_ID` is the admin user ID (numeric for Telegram, string for Mattermost). This user is automatically authorized on first run and can manage other users via `/user add` and `/user remove` commands.

`TASK_PROVIDER` determines which task tracker to use: `kaneo` or `youtrack`. This is set globally for the entire bot deployment.

**Telegram-specific:** `TELEGRAM_BOT_TOKEN`

**Mattermost-specific:** `MATTERMOST_URL`, `MATTERMOST_BOT_TOKEN`

**Kaneo-specific (when TASK_PROVIDER=kaneo):** `KANEO_CLIENT_URL`

**YouTrack-specific (when TASK_PROVIDER=youtrack):** `YOUTRACK_URL`

The remaining credentials are stored per-user in a local SQLite database and configured at runtime via the `/set <key> <value>` command. Use `/config` to view current values. The `/config` command only shows keys relevant to the configured task provider.

**Common config keys (always shown):** `llm_apikey`, `llm_baseurl`, `main_model`, `small_model`, `timezone`

**Kaneo-specific (when TASK_PROVIDER=kaneo):** `kaneo_apikey`

**YouTrack-specific (when TASK_PROVIDER=youtrack):** `youtrack_token`

## Architecture

```
User (Telegram/Mattermost) ─→ ChatProvider (chat/registry.ts) ─→ bot.ts (setupBot)
                                                                        │
                                                                        └─→ llm-orchestrator.ts ─→ Vercel AI SDK generateText
                                                                                                         │
                                                                                                         ├─ tools/ ─→ providers/ ─→ Task tracker REST API
                                                                                                         │   capability-gated tools
                                                                                                         │
                                                                                                         └─→ reply via ReplyFn ─→ chat platform
```

- **`src/index.ts`** — entry point; validates env vars, runs migrations, creates `ChatProvider`, calls `setupBot`, starts the provider.
- **`src/bot.ts`** — platform-agnostic wiring; registers all command handlers and the message handler via `setupBot(chat, adminUserId)`.
- **`src/chat/types.ts`** — `ChatProvider` interface, `ReplyFn`, `IncomingMessage`, `ChatUser`, `ChatFile` types.
- **`src/chat/registry.ts`** — provider factory registry; `createChatProvider(name)` instantiates the named provider. Built-in: `telegram`, `mattermost`.
- **`src/chat/telegram/`** — Grammy-based Telegram adapter (`TelegramChatProvider`). `format.ts` converts LLM markdown to Telegram `MessageEntity[]`.
- **`src/chat/mattermost/`** — Mattermost REST+WebSocket adapter (`MattermostChatProvider`).
- **`src/config.ts`** — SQLite-backed **per-user** runtime config store; exposes `getConfig(userId, key)`, `setConfig(userId, key, value)`, `getAllConfig(userId)`.
- **`src/users.ts`** — SQLite-backed user authorization store; `addUser`, `removeUser`, `isAuthorized`, `isAuthorizedByUsername`, `resolveUserByUsername`, `listUsers`.

- **`src/errors.ts`** — Discriminated union error types (`AppError`), constructors, and `getUserMessage` mapper. `isAppError` uses Zod runtime validation.
- **`src/tools/`** — One file per tool. `index.ts` assembles tools via `makeTools(provider)`, exposing only tools supported by the active provider's capabilities.
- **`src/providers/types.ts`** — `TaskProvider` interface, `Capability` union type, and normalized domain types (`Task`, `Project`, `Comment`, `Label`, `Status`). All providers must implement this interface.
- **`src/providers/registry.ts`** — Provider factory registry; `createProvider(name, config)` instantiates the named provider.
- **`src/providers/errors.ts`** — Provider-layer error types and constructors.
- **`src/providers/kaneo/`** — Kaneo REST API adapter implementing `TaskProvider`. `index.ts` exports `KaneoProvider`. `client.ts` is the shared HTTP client. `classify-error.ts` maps HTTP errors to `AppError`. `frontmatter.ts` stores task relations in description frontmatter.
- **`src/providers/kaneo/schemas/`** — Zod schemas for Kaneo API request/response validation.
- **`src/providers/kaneo/operations/`** — Grouped Kaneo operation implementations (tasks, comments, labels, projects, statuses, relations).
- **`src/providers/youtrack/`** — YouTrack REST API adapter implementing `TaskProvider`. `index.ts` exports `YouTrackProvider`. Uses `youtrack_url` + `youtrack_token` from per-user config.
- **`src/providers/youtrack/schemas/`** — Zod schemas for YouTrack API response validation.
- **`src/commands/`** — Platform-agnostic command handlers. Includes `/help`, `/set`, `/config`, `/clear`, `/context`, and admin commands. Each handler receives `(msg: IncomingMessage, reply: ReplyFn)` — no platform imports. The `/context` command (admin-only) exports conversation history, summary, and known entities as a text file.
- **`src/announcements.ts`** — Automatic version announcements to users with changelog excerpts.
- **`src/changelog-reader.ts`** — CHANGELOG.md reader for version announcements.
- **`src/cache.ts`** — In-memory user session cache with TTL (history, summary, facts, config, workspace, tools). Syncs to SQLite in background via `queueMicrotask`.
- **`src/cache-helpers.ts`** — Helper functions for parsing conversation history from database JSON.
- **`src/conversation.ts`** — Conversation history management with smart trimming and rolling summaries for multi-turn interactions.
- **`src/history.ts`** — Persistent conversation history storage (SQLite-backed per-user).
- **`src/memory.ts`** — Fact extraction and persistence from tool results for long-term context.
- **`src/logger.ts`** — pino logger instance shared across all modules.

### Available tools

Tools are capability-gated: only tools supported by the active provider are exposed to the LLM.

| Tool                   | Capability required | Description                                                                  |
| ---------------------- | ------------------- | ---------------------------------------------------------------------------- |
| `create_task`          | _(always)_          | Create a new task (title, description, priority, project, due date, status)  |
| `update_task`          | _(always)_          | Update status, priority, assignee, due date, title, or description on a task |
| `search_tasks`         | _(always)_          | Search tasks by keyword                                                      |
| `list_tasks`           | _(always)_          | List all tasks in a project                                                  |
| `get_task`             | _(always)_          | Fetch full details of a single task including relations                      |
| `archive_task`         | `tasks.archive`     | Archive a task                                                               |
| `delete_task`          | `tasks.delete`      | Permanently delete a task                                                    |
| `add_comment`          | `comments.create`   | Add a comment to a task                                                      |
| `get_comments`         | `comments.read`     | Read all comments on a task                                                  |
| `update_comment`       | `comments.update`   | Update an existing comment on a task                                         |
| `remove_comment`       | `comments.delete`   | Remove a comment from a task                                                 |
| `list_projects`        | `projects.list`     | List all projects in the workspace                                           |
| `create_project`       | `projects.create`   | Create a new project in the workspace                                        |
| `update_project`       | `projects.update`   | Update an existing project (name, description)                               |
| `archive_project`      | `projects.archive`  | Archive (delete) a project                                                   |
| `list_labels`          | `labels.list`       | List all available labels in the workspace                                   |
| `create_label`         | `labels.create`     | Create a new label with optional hex color                                   |
| `update_label`         | `labels.update`     | Update an existing label (name, color)                                       |
| `remove_label`         | `labels.delete`     | Remove (delete) a label                                                      |
| `add_task_label`       | `labels.assign`     | Add a label to a task                                                        |
| `remove_task_label`    | `labels.assign`     | Remove a label from a task                                                   |
| `add_task_relation`    | `tasks.relations`   | Create a blocks/duplicate/related relation between two tasks                 |
| `update_task_relation` | `tasks.relations`   | Update the type of an existing relation between two tasks                    |
| `remove_task_relation` | `tasks.relations`   | Remove a relation between two tasks                                          |
| `list_statuses`        | `statuses.list`     | List all status columns in a project                                         |
| `create_status`        | `statuses.create`   | Create a new status column in a project                                      |
| `update_status`        | `statuses.update`   | Update an existing status column (name, order)                               |
| `delete_status`        | `statuses.delete`   | Delete a status column from a project                                        |
| `reorder_statuses`     | `statuses.reorder`  | Reorder status columns in a project                                          |

## Logging

Logging is **mandatory**. Uses pino with structured JSON output. See `src/tools/CLAUDE.md`, `src/providers/CLAUDE.md` for path-specific rules.

Quick reference:

- `debug`: function entry with parameters, internal state, API calls
- `info`: successful major operations, service call results
- `warn`: invalid input, failed lookups, unauthorized attempts
- `error`: caught exceptions, failed API calls — always include error message + context
- Format: `logger.debug({ userId, count }, 'Message')` — structured metadata first, message second
- Use `param !== undefined` not `!!param` (strict-boolean-expressions)
- Never log API keys, tokens, or personal info

## Testing

See `tests/CLAUDE.md` for detailed testing conventions, mocking rules, and mock pollution prevention.

Quick reference:

- `bun test` — unit tests (excludes E2E)
- `bun test:e2e` — E2E tests (requires Docker)
- Use shared helpers from `tests/utils/test-helpers.ts` and `tests/tools/mock-provider.ts`
- Use mutable `let impl` pattern for module mocks (not `spyOn().mockImplementation()`)
- `mock.module()` is global — always add `afterAll(() => { mock.restore() })` for shared modules
- Run `bun run mock-pollution` after adding new mocks

## Key Conventions

- Runtime: **Bun** (not Node)
- Validation: **Zod v4** for all schemas
- LLM integration: **Vercel AI SDK** (`ai` package) with `@ai-sdk/openai`
- Chat platforms: **Grammy** (Telegram adapter), Mattermost REST+WebSocket
- Linting/formatting: **oxlint / oxfmt** (not ESLint/Prettier)
- Strict TypeScript (`tsconfig.json` has strict mode + all safety flags)
- Logging: **pino** with structured JSON output
- Tests: Located in `tests/` directory, mirroring `src/` structure
- NEVER add lint-disable comments (`eslint-disable`, `@ts-ignore`, `@ts-nocheck`, `oxlint-disable`) — fix the underlying issue
- Use `.js` extension in import paths (Bun ESM resolution)
- Error message extraction: `error instanceof Error ? error.message : String(error)`

## Path-Scoped Conventions

Detailed conventions live in subdirectory `CLAUDE.md` files (loaded by Claude Code and opencode) and `.github/instructions/*.instructions.md` files (loaded by GitHub Copilot):

| Path | Covers |
|------|--------|
| `src/providers/CLAUDE.md` | TaskProvider interface, operations, schemas, error classification |
| `src/tools/CLAUDE.md` | Tool definitions, capability gating, destructive actions |
| `src/commands/CLAUDE.md` | Command handler pattern, auth checks, ReplyFn |
| `src/chat/CLAUDE.md` | ChatProvider interface, platform adapters |
| `tests/CLAUDE.md` | Test helpers, mocking rules, mock pollution, E2E testing |
