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
- `bun check` — run all checks in parallel (lint, typecheck, format:check, knip, test, security)
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
`CHAT_PROVIDER`, `ADMIN_USER_ID`

`ADMIN_USER_ID` is the admin user ID (numeric for Telegram, string for Mattermost). This user is automatically authorized on first run and can manage other users via `/user add` and `/user remove` commands.

**Telegram-specific:** `TELEGRAM_BOT_TOKEN`

**Mattermost-specific:** `MATTERMOST_URL`, `MATTERMOST_BOT_TOKEN`

The remaining credentials are stored per-user in a local SQLite database and configured at runtime via the `/set <key> <value>` command. Use `/config` to view current values.

**Common config keys:** `llm_apikey`, `llm_baseurl`, `main_model`, `small_model`, `provider`

**Kaneo-specific (default provider):** `kaneo_apikey`

**YouTrack-specific:** `youtrack_url`, `youtrack_token`

Additional environment variables used by the bot:

- `KANEO_CLIENT_URL` — Kaneo instance URL (required, set in `.env`)

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

## Logging Requirements (HIGH PRIORITY)

Logging is **mandatory** for debugging and operational visibility. The logger uses pino with structured JSON output. Every significant action, state change, and error must be logged.

### When to Use Each Log Level

#### `logger.debug()` — Detailed diagnostics

Use for:

- Function entry points with all input parameters (use `param !== undefined` not `!!param`)
- Internal state transitions
- API call initiation and raw responses
- Authorization checks
- Tool execution entry
- Example: `logger.debug({ userId, historyLength }, 'Calling generateText')`

#### `logger.info()` — Significant events

Use for:

- Successful completion of major operations (task created/updated, search completed)
- External service calls with result summaries
- User session lifecycle events
- Example: `logger.info({ taskId, title }, 'Task created')`

#### `logger.warn()` — Unexpected but recoverable

Use for:

- Invalid input that won't crash the app
- Missing optional data
- Failed lookups (columns not found)
- Resource limits reached (history truncation)
- Unauthorized access attempts
- API returning incomplete data
- Example: `logger.warn({ taskId, requestedStatus }, 'Column not found')`

#### `logger.error()` — Failures requiring attention

Use for:

- All caught exceptions
- Failed external API calls
- Critical operation failures
- Always include error message and context
- Example: `logger.error({ error: error.message, userId }, 'Error generating response')`

### Log Format Rules

1. **Always use structured logging**: Pass metadata as first argument object, message as second
2. **Include context**: userId, identifiers, counts, booleans for presence checks
3. **Never log sensitive data**: No API keys, tokens, or personal info in logs
4. **Use explicit undefined checks**: `field !== undefined` not `!!field` (strict-boolean-expressions)
5. **Keep messages concise**: One clear action verb phrase

### Required Logging Locations

Every file must import and use the logger. Required log points:

- All function entries in `src/providers/kaneo/`
- All tool executions in `src/tools/`
- Message lifecycle in `bot.ts` (receive, process, respond)
- Authorization checks
- Error catch blocks

## Testing

Tests are located in the `tests/` directory:

```
tests/
├── *.test.ts         # Unit tests (run with bun run test)
├── providers/        # Unit tests for src/providers/*
│   ├── kaneo/
│   └── youtrack/
├── tools/            # Unit tests for src/tools/*
└── e2e/              # E2E tests (run with bun run test:e2e)
```

For unit tests, use `bun run test`.

## E2E Testing

E2E tests run against a real Kaneo instance in Docker using the existing `docker-compose.yml` setup. They verify the actual integration between papai's tools and the Kaneo API.

### Prerequisites

Ensure your `.env` file has the required Kaneo environment variables:

- `KANEO_POSTGRES_PASSWORD`
- `KANEO_AUTH_SECRET`
- `KANEO_CLIENT_URL`

### Running E2E Tests

```bash
# Run all e2e tests (Docker containers start/stop automatically)
bun run test:e2e

# Run in watch mode
bun run test:e2e:watch
```

### E2E Test Structure

- `tests/e2e/bun-test-setup.ts` - Global setup (Docker, provisioning) loaded via `--preload`
- `tests/e2e/global-setup.ts` - Setup logic and config management
- `tests/e2e/e2e.test.ts` - Orchestrator that imports all test suites
- `tests/e2e/kaneo-test-client.ts` - Test utilities and resource cleanup
- `tests/e2e/*.test.ts` - Individual e2e test files (no setup/teardown needed)
- Uses existing `docker-compose.yml` + `docker-compose.test.yml` (no new compose files needed)

### Writing E2E Tests

Global setup is handled automatically by `bun-test-setup.ts`. Individual test files only need to focus on test logic:

1. Use `KaneoTestClient` for resource management
2. Call `testClient.trackTask(taskId)` for automatic cleanup
3. Clean up in `beforeEach` for test isolation
4. No need for `beforeAll`/`afterAll` - setup is global

Example:

```typescript
import { beforeEach, describe, expect, test } from 'bun:test'
import type { KaneoConfig } from '../../src/providers/kaneo/client.js'
import { createTestClient, type KaneoTestClient } from './kaneo-test-client.js'

describe('My Feature', () => {
  let testClient: KaneoTestClient
  let kaneoConfig: KaneoConfig

  beforeEach(async () => {
    testClient = createTestClient()
    kaneoConfig = testClient.getKaneoConfig()
    await testClient.cleanup()
  })

  test('does something', async () => {
    // Your test here - example:
    // const task = await createTask(kaneoConfig, { title: 'Test', projectId })
    // testClient.trackTask(task.id)
  })
})
```

### Environment Variables

Create `tests/e2e/.env.e2e` from `.env.e2e.example`:

- `E2E_KANEO_URL` - URL of the Kaneo instance (defaults to `KANEO_INTERNAL_URL` or `http://localhost:11337`)

### Running E2E Tests in CI

E2E tests run automatically in GitHub Actions on every push and PR. The CI workflow:

1. Sets up Docker using `docker/setup-buildx-action`
2. Creates required environment variables (`KANEO_POSTGRES_PASSWORD`, `KANEO_AUTH_SECRET`, `KANEO_CLIENT_URL`)
3. Runs `bun run test:e2e` which automatically manages Docker containers

The CI configuration is in `.github/workflows/ci.yml`.

### E2E Test Coverage

All Kaneo API operations are covered by E2E tests:

#### Task Operations

- `task-lifecycle.test.ts` - Create, read, update tasks
- `task-comments.test.ts` - Add, get, update, remove comments
- `task-relations.test.ts` - blocks, blocked_by, duplicate, related, parent relations
- `task-archive.test.ts` - Archive with labels
- `task-search.test.ts` - Search by keyword, status, priority, filters

#### Project Operations

- `project-lifecycle.test.ts` - Create, list, update
- `project-archive.test.ts` - Archive projects

#### Column Operations

- `column-management.test.ts` - Create, update, delete, reorder columns

#### Label Operations

- `label-management.test.ts` - Create, update labels, add/remove from tasks
- `label-operations.test.ts` - Full label CRUD and task associations

#### Error Handling

- `error-handling.test.ts` - 404, 400, validation errors, edge cases

#### User Workflows

- `user-workflows.test.ts` - Full lifecycle, project setup, dependencies, sprints, bulk ops

## Key Conventions

- Runtime: **Bun** (not Node)
- Validation: **Zod v4** for all schemas
- LLM integration: **Vercel AI SDK** (`ai` package) with `@ai-sdk/openai`
- Chat platforms: **Grammy** (Telegram adapter), Mattermost REST+WebSocket
- Linting/formatting: **oxlint / oxfmt** (not ESLint/Prettier)
- Strict TypeScript (`tsconfig.json` has strict mode + all safety flags)
- Logging: **pino** with structured JSON output
- Tests: Located in `tests/` directory, mirroring `src/` structure
