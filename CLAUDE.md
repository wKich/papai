# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

papai is a Telegram bot that manages Kaneo tasks via LLM tool-calling. A user sends natural language messages through Telegram, the bot invokes a configurable OpenAI-compatible LLM (via Vercel AI SDK) which autonomously selects and executes Kaneo operations, then replies with the result. The provider, base URL, and model are all runtime-configurable — any OpenAI-compatible endpoint works (OpenAI, Anthropic, Mistral, Ollama, etc.).

## Commands

- `bun run start` — run the bot (`bun run src/index.ts`)
- `bun run lint` — lint with oxlint
- `bun run format` — format with oxfmt
- `bun install` — install dependencies

No build step; Bun runs TypeScript directly.

## Required Environment Variables

Copy `.env.example` to `.env`. Only two are required at startup (validated in `src/index.ts`):
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_USER_ID`

`TELEGRAM_USER_ID` is the admin user ID. This user is automatically authorized on first run and can manage other users via `/user add` and `/user remove` commands.

The remaining credentials (`kaneo_apikey`, `llm_apikey`, `llm_baseurl`, `main_model`, `small_model`) are stored per-user in a local SQLite database and configured at runtime via the `/set <key> <value>` Telegram command. Use `/config` to view current values.

Additional environment variables used by the bot:

- `KANEO_CLIENT_URL` — Kaneo instance URL (required, set in `.env`)

## Architecture

```
Telegram user ─→ Grammy bot (bot.ts) ─→ Vercel AI SDK generateText (any OpenAI-compatible LLM)
                                              │
                                              ├─ tools/ ─→ kaneo/ ─→ Kaneo REST API
                                              │   28 tools, one file each
                                              │
                                              └─→ response back to Telegram
```

- **`src/index.ts`** — entry point; validates env vars, runs migrations, starts the bot.
- **`src/bot.ts`** — Grammy bot setup, per-user conversation history, LLM orchestration with up to 25 tool-calling steps. Multi-user authorization via `users` table.
- **`src/admin-commands.ts`** — Legacy admin command registration (handlers moved to `src/commands/`).
- **`src/config.ts`** — SQLite-backed **per-user** runtime config store; exposes `getConfig(userId, key)`, `setConfig(userId, key, value)`, `getAllConfig(userId)`.
- **`src/users.ts`** — SQLite-backed user authorization store; `addUser`, `removeUser`, `isAuthorized`, `isAuthorizedByUsername`, `resolveUserByUsername`, `listUsers`.
- **`src/migrate.ts`** — One-time runtime migration: seeds admin user, copies legacy `config` rows to per-user `user_config`.
- **`src/errors.ts`** — Discriminated union error types (`AppError`), constructors, and `getUserMessage` mapper. `isAppError` uses Zod runtime validation.
- **`src/tools/`** — One file per tool. `index.ts` assembles all 28 into `makeTools`. Each tool imports its corresponding kaneo function.
- **`src/kaneo/`** — One file per Kaneo REST API wrapper function. `index.ts` re-exports all. `client.ts` is the shared HTTP client. `classify-error.ts` contains the error classifier. `frontmatter.ts` handles relation storage in task descriptions.
- **`src/commands/`** — Telegram command handlers extracted from bot.ts. Includes `/help`, `/set`, `/config`, `/clear`, and admin commands.
- **`src/conversation.ts`** — Conversation history management with smart trimming and rolling summaries for multi-turn interactions.
- **`src/history.ts`** — Persistent conversation history storage (SQLite-backed per-user).
- **`src/memory.ts`** — Fact extraction and persistence from tool results for long-term context.
- **`src/logger.ts`** — pino logger instance shared across all modules.

### Available tools

| Tool                   | Description                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `create_task`          | Create a new task (title, description, priority, project, due date, status)          |
| `update_task`          | Update status, priority, assignee, due date, title, or description on a task         |
| `search_tasks`         | Search tasks by keyword                                                              |
| `list_tasks`           | List all tasks in a project                                                          |
| `get_task`             | Fetch full details of a single task including relations (from frontmatter)           |
| `archive_task`         | Archive a task by adding the "archived" label                                        |
| `add_comment`          | Add a comment to a task                                                              |
| `get_comments`         | Read all comments on a task                                                          |
| `update_comment`       | Update an existing comment on a task                                                 |
| `remove_comment`       | Remove a comment from a task                                                         |
| `list_projects`        | List all projects in the workspace                                                   |
| `create_project`       | Create a new project in the workspace                                                |
| `update_project`       | Update an existing project (name, description)                                       |
| `archive_project`      | Archive (delete) a project                                                           |
| `list_labels`          | List all available labels in the workspace                                           |
| `create_label`         | Create a new label with optional hex color                                           |
| `update_label`         | Update an existing label (name, color)                                               |
| `remove_label`         | Remove (delete) a label                                                              |
| `add_task_label`       | Add a label to a task                                                                |
| `remove_task_label`    | Remove a label from a task                                                           |
| `add_task_relation`    | Create a blocks/duplicate/related relation between two tasks (stored in frontmatter) |
| `update_task_relation` | Update the type of an existing relation between two tasks                            |
| `remove_task_relation` | Remove a relation between two tasks                                                  |
| `list_columns`         | List all status columns in a project                                                 |
| `create_column`        | Create a new status column in a project                                              |
| `update_column`        | Update an existing column (name, order)                                              |
| `delete_column`        | Delete a status column from a project                                                |
| `reorder_columns`      | Reorder columns in a project                                                         |

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

- All function entries in `src/kaneo/`
- All tool executions in `src/tools/`
- Message lifecycle in `bot.ts` (receive, process, respond)
- Authorization checks
- Error catch blocks

## Testing

Tests are located in the `tests/` directory:

```
tests/
├── *.test.ts         # Unit tests (run with bun test)
├── kaneo/            # Unit tests for src/kaneo/*
├── tools/            # Unit tests for src/tools/*
└── e2e/              # E2E tests (run with bun run test:e2e)
```

Run tests with `bun test` or `bun run test`.

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
import type { KaneoConfig } from '../../src/kaneo/client.js'
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
- Bot framework: **Grammy**
- Linting/formatting: **oxlint / oxfmt** (not ESLint/Prettier)
- Strict TypeScript (`tsconfig.json` has strict mode + all safety flags)
- Logging: **pino** with structured JSON output
- Tests: Located in `tests/` directory, mirroring `src/` structure
