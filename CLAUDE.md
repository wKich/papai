# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

papai is a chat bot that manages tasks via LLM tool-calling. A user sends natural language messages through a configurable chat platform (Telegram or Mattermost), the bot invokes a configurable OpenAI-compatible LLM (via Vercel AI SDK) which autonomously selects and executes task tracker operations, then replies with the result. The chat platform, task tracker provider (Kaneo, YouTrack, or any future provider), LLM provider, base URL, and model are all runtime-configurable.

## Commands

All scripts can be run with `bun <script>` (no `run` keyword needed):

- `bun start` — build the dashboard client and run the bot
- `bun build:client` — bundle the debug dashboard UI from `client/debug/` to `public/`
- `bun lint` — lint with oxlint
- `bun lint:fix` — lint with auto-fix
- `bun format` — format with oxfmt
- `bun format:check` — check formatting without writing
- `bun knip` — check for unused dependencies/exports
- `bun typecheck` — TypeScript type checking
- `bun security` — run Semgrep security scan locally
- `bun security:ci` — run security scan with JSON/SARIF output for CI
- `bun test` — run unit tests (excludes E2E and client tests)
- `bun test:client` — run client (dashboard UI) tests with happy-dom
- `bun test:watch` — run unit tests in watch mode
- `bun test:coverage` — run unit tests with coverage
- `bun test:e2e` — run E2E tests (requires Docker)
- `bun test:e2e:watch` — run E2E tests in watch mode
- `bun check` — run lint/typecheck/format on staged files only (fast, used by pre-commit hook)
- `bun check:full` — run all checks, suppressing success output
- `bun check:verbose` — run all checks with verbose output (lint, typecheck, format:check, knip, test, duplicates)
- `bun fix` — auto-fix lint and format issues
- `bun install` — install dependencies

The server is run by Bun directly with no build step. The debug dashboard UI in `client/debug/` is bundled to `public/` via `bun build:client` (run automatically by `bun start`).

## Testing

**Unit tests** (excludes E2E tests):

```bash
bun test           # or: bun run test
```

**Client tests** (dashboard UI, requires happy-dom):

```bash
bun test:client    # or: bun run test:client
```

**E2E tests** (requires Docker):

```bash
bun test:e2e       # or: bun run test:e2e
```

The `bunfig.toml` is configured with `pathIgnorePatterns` to exclude both E2E tests and client tests from the default `bun test` command. Client tests live under `tests/client/` and run against `client/debug/` modules with happy-dom providing browser globals — they must be run separately via `bun test:client`. E2E tests require Docker to spin up a Kaneo instance and must be run separately via `bun test:e2e`.

## TDD Enforcement (Hooks)

Every `Write`, `Edit`, and `MultiEdit` on a file in `src/` or `client/` triggers
an automated hook pipeline. The pipeline enforces Red → Green → Refactor by
running checks sequentially and blocking when a check fails.

### Scope

Only **implementation files in `src/` or `client/`** are checked:

- Path starts with `src/` or `client/`
- Extension: `.ts`, `.js`, `.tsx`, `.jsx`
- Not a test file (`*.test.*` / `*.spec.*`)

Everything else (docs, config, test files, files outside `src/`/`client/`)
passes through without checks. Test file edits only verify that the test itself
still passes.

The `client/` tree mirrors `src/` for path resolution: `client/debug/foo.ts` is
expected to have a test at `tests/client/debug/foo.test.ts`.

### Pipeline

Two orchestrator hooks run sequentially with short-circuit logic:

**Before the file is written (PreToolUse):**

1. **Test-first gate** — a test file must exist for the implementation file
   being written, and it must import the implementation module. Checked on disk
   first, then in session state (for tests written earlier this session). If no
   test exists or the test doesn't import the impl → **blocked**, remaining
   checks skipped.
2. **API surface snapshot** — captures the file's exported names, function
   parameter counts, and line coverage before the edit.
3. **Mutation snapshot** — runs Stryker and records surviving mutants before the
   edit. Skipped when `TDD_MUTATION=0`.

**After the file is written (PostToolUse):**

4. **Test tracker** — if the written file is a test, records its path in session
   state so the test gate allows the corresponding impl write.
5. **Import gate** — if the written file is a test under `tests/`, verifies it
   imports its corresponding implementation module (e.g. `tests/foo/bar.test.ts`
   must import from `../../src/foo/bar.js`). If not → **blocked**, remaining
   checks skipped. Prevents bypassing TDD by declaring test files that don't
   actually test the named module.
6. **Test runner** — runs `bun test` on the corresponding test file. If tests
   fail → **blocked**, remaining checks skipped. If tests pass, compares line
   coverage against the session baseline (captured once per session). If coverage
   dropped → **blocked**, remaining checks skipped.
7. **API surface diff** — compares exports, parameter counts, and uncovered
   lines against the pre-edit snapshot. Blocks if any of these expanded (new
   exports, more parameters, more uncovered lines).
8. **Mutation diff** — re-runs Stryker and compares surviving mutants against
   the pre-edit snapshot. Blocks if new mutants survived (code changes that no
   test catches). Skipped when `TDD_MUTATION=0`.

If both checks 7 and 8 block, their messages are combined into a single response.

### Workflow

**Adding new behavior to a new file:**

1. Write the test file (`tests/foo/bar.test.ts`) — the test must import from
   `../../src/foo/bar.js`. Check 5 verifies the import. Check 6 blocks
   because the test fails (impl missing). This is expected.
2. Write the impl file (`src/foo/bar.ts`) — test gate passes (test exists and
   imports impl). No snapshots taken (new file). Check 6 runs the test — must pass.

**Adding new behavior to an existing file:**

1. Write/update the test in `tests/` for the new behavior — check 6 blocks
   because the test fails (the impl doesn't have the new behavior yet).
2. Edit the impl in `src/` to make the test pass — snapshots are taken before
   the edit. After the edit, check 6 must pass. Check 7 may report new
   exports or parameters — if it blocks, write tests that cover the new
   surface before continuing. Check 8 passes if your tests catch all new
   code paths.

**Refactoring (no behavior change):**

1. Edit the impl directly — test gate passes (test exists). Snapshots taken.
2. After the edit: tests must stay green, coverage must not drop, no new exports
   or parameters, no new surviving mutants.

**Removing a feature:**

1. Remove or reduce the tests first — passes through (test files are trusted).
2. Remove the impl code — remaining tests must still pass. Checks 7 and 8 see
   fewer exports and fewer mutants (contraction passes).

### Test naming convention

`src/foo/bar.ts` → `tests/foo/bar.test.ts`

### Mutation testing speed

Mutation testing adds 30–120 seconds per impl file edit (runs Stryker before
and after). Set `TDD_MUTATION=0` to disable during rapid iteration. Checks 2, 6,
and 7 (surface and coverage) still enforce refactor purity without Stryker.

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
- **`src/chat/types.ts`** — `ChatProvider` interface, `ReplyFn`, `IncomingMessage`, `ChatUser`, `ChatFile`, `ThreadCapabilities` types.
- **`src/chat/registry.ts`** — provider factory registry; `createChatProvider(name)` instantiates the named provider. Built-in: `telegram`, `mattermost`.
- **`src/chat/telegram/`** — Grammy-based Telegram adapter (`TelegramChatProvider`). `format.ts` converts LLM markdown to Telegram `MessageEntity[]`. Supports forum topics (threads) for group chats.
- **`src/chat/mattermost/`** — Mattermost REST+WebSocket adapter (`MattermostChatProvider`).
- **`src/config.ts`** — SQLite-backed **per-user** runtime config store; exposes `getConfig(userId, key)`, `setConfig(userId, key, value)`, `getAllConfig(userId)`.
- **`src/users.ts`** — SQLite-backed user authorization store; `addUser`, `removeUser`, `isAuthorized`, `isAuthorizedByUsername`, `resolveUserByUsername`, `listUsers`.

- **`src/errors.ts`** — Discriminated union error types (`AppError`), constructors, and `getUserMessage` mapper. `isAppError` uses Zod runtime validation.
- **`src/tools/`** — One file per tool. `index.ts` assembles tools via `makeTools(provider)`, exposing only tools supported by the active provider's capabilities.
- **`src/providers/types.ts`** — `TaskProvider` interface, `Capability` union type, and normalized domain types (`Task`, `Project`, `Comment`, `Label`, `Status`). All providers must implement this interface.
- **`src/providers/registry.ts`** — Provider factory registry; `createProvider(name, config)` instantiates the named provider.
- **`src/providers/errors.ts`** — Provider-layer error types and constructors.
- **`src/providers/kaneo/`** — Kaneo REST API adapter implementing `TaskProvider`. `index.ts` exports `KaneoProvider`. `client.ts` is the shared HTTP client. `classify-error.ts` maps HTTP errors to `AppError`. `frontmatter.ts` stores task relations in description frontmatter. Includes identity resolver for linking chat users to Kaneo users.
- **`src/providers/kaneo/schemas/`** — Zod schemas for Kaneo API request/response validation.
- **`src/providers/kaneo/operations/`** — Grouped Kaneo operation implementations (tasks, comments, labels, projects, statuses, relations, users).
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
- **`src/identity/`** — Identity resolution system for linking chat users to task tracker users. `resolver.ts` provides `resolveMeReference()` for natural language "me" references.
- **`src/deferred-prompts/`** — Scheduled prompt execution system. Supports once/delayed/cron schedules with proactive delivery modes.
- **`src/scheduler.ts`** — Cron-based task scheduler for recurring tasks and deferred prompts.
- **`src/proactive-delivery/`** — Proactive message delivery system with normal, alert, and notify modes.
- **`src/embeddings.ts`** — Vector embeddings generation for semantic memo search.
- **`src/memos/`** — Quick notes/memos storage and search with embedding-based semantic search.
- **`src/instructions/`** — Per-context custom instructions storage.
- **`src/debug/`** — server-side debug instrumentation: SSE event bus, log buffer, state collector, and the HTTP server that serves the dashboard from `public/`. The dashboard UI itself lives in `client/debug/`.
- **`client/debug/`** — debug dashboard browser code (TypeScript + HTML + CSS). Bundled to `public/dashboard.js` via `bun build:client` (using `Bun.build()` IIFE format). The single entry point `client/debug/index.ts` imports the API setup, state, tree-view click handler, and bootstrap modules in order. Tests live at `tests/client/debug/` and run with happy-dom via `bun test:client`.

### Available tools

Tools are capability-gated: only tools supported by the active provider are exposed to the LLM.

#### Core Task Tools (always available)

| Tool           | Description                                                                  |
| -------------- | ---------------------------------------------------------------------------- |
| `create_task`  | Create a new task (title, description, priority, project, due date, status)  |
| `update_task`  | Update status, priority, assignee, due date, title, or description on a task |
| `search_tasks` | Search tasks by keyword                                                      |
| `list_tasks`   | List all tasks in a project                                                  |
| `get_task`     | Fetch full details of a single task including relations                      |
| `count_tasks`  | Count tasks matching criteria                                                |
| `delete_task`  | Permanently delete a task (requires `tasks.delete`)                          |

#### Task Relations (requires `tasks.relations`)

| Tool                   | Description                                                          |
| ---------------------- | -------------------------------------------------------------------- |
| `add_task_relation`    | Create a blocks/duplicate/related/subtask relation between two tasks |
| `update_task_relation` | Update the type of an existing relation between two tasks            |
| `remove_task_relation` | Remove a relation between two tasks                                  |

#### Task Collaboration (requires `tasks.watchers`, `tasks.votes`, `tasks.visibility`)

| Tool             | Capability         | Description                          |
| ---------------- | ------------------ | ------------------------------------ |
| `list_watchers`  | `tasks.watchers`   | List watchers on a task              |
| `add_watcher`    | `tasks.watchers`   | Add a watcher to a task              |
| `remove_watcher` | `tasks.watchers`   | Remove a watcher from a task         |
| `add_vote`       | `tasks.votes`      | Add a vote to a task                 |
| `remove_vote`    | `tasks.votes`      | Remove a vote from a task            |
| `set_visibility` | `tasks.visibility` | Set task visibility (public/private) |
| `find_user`      | _(varies)_         | Find a user by username or email     |

#### Comments (requires `comments.*` capabilities)

| Tool                      | Capability           | Description                        |
| ------------------------- | -------------------- | ---------------------------------- |
| `get_comments`            | `comments.read`      | Read all comments on a task        |
| `add_comment`             | `comments.create`    | Add a comment to a task            |
| `update_comment`          | `comments.update`    | Update an existing comment         |
| `remove_comment`          | `comments.delete`    | Remove a comment                   |
| `add_comment_reaction`    | `comments.reactions` | Add an emoji reaction to a comment |
| `remove_comment_reaction` | `comments.reactions` | Remove an emoji reaction           |

#### Projects (requires `projects.*` capabilities)

| Tool                    | Capability        | Description                        |
| ----------------------- | ----------------- | ---------------------------------- |
| `list_projects`         | `projects.list`   | List all projects in the workspace |
| `create_project`        | `projects.create` | Create a new project               |
| `update_project`        | `projects.update` | Update project name/description    |
| `delete_project`        | `projects.delete` | Delete a project                   |
| `list_project_team`     | `projects.team`   | List project team members          |
| `add_project_member`    | `projects.team`   | Add a member to a project          |
| `remove_project_member` | `projects.team`   | Remove a member from a project     |

#### Labels (requires `labels.*` capabilities)

| Tool                | Capability      | Description                            |
| ------------------- | --------------- | -------------------------------------- |
| `list_labels`       | `labels.list`   | List all available labels              |
| `create_label`      | `labels.create` | Create a new label with optional color |
| `update_label`      | `labels.update` | Update label name/color                |
| `remove_label`      | `labels.delete` | Delete a label                         |
| `add_task_label`    | `labels.assign` | Add a label to a task                  |
| `remove_task_label` | `labels.assign` | Remove a label from a task             |

#### Statuses (requires `statuses.*` capabilities)

| Tool               | Capability         | Description                          |
| ------------------ | ------------------ | ------------------------------------ |
| `list_statuses`    | `statuses.list`    | List all status columns in a project |
| `create_status`    | `statuses.create`  | Create a new status column           |
| `update_status`    | `statuses.update`  | Update status name/order             |
| `delete_status`    | `statuses.delete`  | Delete a status column               |
| `reorder_statuses` | `statuses.reorder` | Reorder status columns               |

#### Work Items / Time Tracking (requires `workItems.*` capabilities)

| Tool          | Capability         | Description                             |
| ------------- | ------------------ | --------------------------------------- |
| `list_work`   | `workItems.list`   | List logged work/time entries on a task |
| `log_work`    | `workItems.create` | Log work/time on a task                 |
| `update_work` | `workItems.update` | Update a logged work entry              |
| `remove_work` | `workItems.delete` | Delete a logged work entry              |

#### Attachments (requires `attachments.*` capabilities)

| Tool                | Capability           | Description                |
| ------------------- | -------------------- | -------------------------- |
| `list_attachments`  | `attachments.list`   | List attachments on a task |
| `upload_attachment` | `attachments.upload` | Upload a file attachment   |
| `remove_attachment` | `attachments.delete` | Remove an attachment       |

#### Memos (user-scoped, always available)

| Tool            | Description              |
| --------------- | ------------------------ |
| `save_memo`     | Save a quick note/memo   |
| `search_memos`  | Search saved memos       |
| `list_memos`    | List all memos           |
| `archive_memos` | Archive completed memos  |
| `promote_memo`  | Convert a memo to a task |

#### Recurring Tasks (user-scoped, always available)

| Tool                    | Description                      |
| ----------------------- | -------------------------------- |
| `create_recurring_task` | Create a recurring task template |
| `list_recurring_tasks`  | List recurring task templates    |
| `update_recurring_task` | Update a recurring task          |
| `pause_recurring_task`  | Pause a recurring task           |
| `resume_recurring_task` | Resume a paused recurring task   |
| `skip_recurring_task`   | Skip the next occurrence         |
| `delete_recurring_task` | Delete a recurring task template |

#### Deferred Prompts (user-scoped, always available)

| Tool                     | Description                           |
| ------------------------ | ------------------------------------- |
| `create_deferred_prompt` | Schedule a prompt for later execution |
| `list_deferred_prompts`  | List scheduled prompts                |
| `get_deferred_prompt`    | Get details of a scheduled prompt     |
| `update_deferred_prompt` | Update a scheduled prompt             |
| `cancel_deferred_prompt` | Cancel a scheduled prompt             |

#### Instructions (context-scoped, always available)

| Tool                 | Description                                |
| -------------------- | ------------------------------------------ |
| `save_instruction`   | Save a custom instruction for this context |
| `list_instructions`  | List custom instructions                   |
| `delete_instruction` | Delete a custom instruction                |

#### Identity Resolution (requires provider with `identityResolver`)

| Tool                | Description                                  |
| ------------------- | -------------------------------------------- |
| `set_my_identity`   | Link your chat identity to task tracker user |
| `clear_my_identity` | Unlink your task tracker identity            |

#### Group Chat Tools

| Tool                   | Description                               |
| ---------------------- | ----------------------------------------- |
| `lookup_group_history` | Search conversation history in this group |

#### Utility Tools

| Tool               | Description                         |
| ------------------ | ----------------------------------- |
| `get_current_time` | Get current time in user's timezone |

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

- `bun test` — unit tests (excludes E2E and client tests)
- `bun test:client` — run client (dashboard UI) tests with happy-dom
- `bun test:e2e` — E2E tests (requires Docker)

### Test Helpers (use these, don't reinvent)

| Helper                 | Location                       | Purpose                                                |
| ---------------------- | ------------------------------ | ------------------------------------------------------ |
| `mockLogger()`         | `tests/utils/test-helpers.ts`  | Stubs pino logger globally                             |
| `setupTestDb()`        | `tests/utils/test-helpers.ts`  | Creates in-memory SQLite with all migrations           |
| `createMockReply()`    | `tests/utils/test-helpers.ts`  | Captures `reply.text()` calls for assertions           |
| `createDmMessage()`    | `tests/utils/test-helpers.ts`  | Factory for DM `IncomingMessage`                       |
| `createGroupMessage()` | `tests/utils/test-helpers.ts`  | Factory for group `IncomingMessage`                    |
| `createAuth()`         | `tests/utils/test-helpers.ts`  | Factory for `AuthorizationResult`                      |
| `createMockChat()`     | `tests/utils/test-helpers.ts`  | Mock `ChatProvider` capturing command registrations    |
| `mockMessageCache()`   | `tests/utils/test-helpers.ts`  | Test-local message cache (isolated)                    |
| `expectAppError()`     | `tests/utils/test-helpers.ts`  | Asserts error is `AppError` with expected user message |
| `createMockProvider()` | `tests/tools/mock-provider.ts` | Fully-stubbed `TaskProvider` with overridable methods  |
| `schemaValidates()`    | `tests/test-helpers.ts`        | Tests tool input schemas accept/reject given data      |
| `getToolExecutor()`    | `tests/test-helpers.ts`        | Extracts tool `execute` function                       |

### Mocking Rules

- **Prefer dependency injection over `mock.module()`** — most modules export a `Deps` interface and accept an optional `deps` parameter
- NEVER mock `globalThis.fetch` directly — use `setMockFetch()` / `restoreFetch()` from `tests/test-helpers.ts`
- NEVER use `spyOn().mockImplementation()` for module mocks — use DI or mutable `let impl` pattern
- Use `mock()` from `bun:test` for spy functions
- `mock.module()` is still required for: `ai`, `@ai-sdk/openai-compatible`, `logger`, and a few provider modules

### Dependency Injection Pattern (preferred)

```typescript
// Source module exports Deps interface
export interface SomeDeps {
  dependency: () => ReturnType
}
const defaultDeps: SomeDeps = { /* real implementations */ }
export function someFunction(deps: SomeDeps = defaultDeps) { ... }

// Tests pass fakes directly
const deps: SomeDeps = { dependency: (): ReturnType => fakeValue }
someFunction(deps)
```

### Mock Pollution Prevention

`mock.module()` is global and permanent in Bun. The preload `tests/mock-reset.ts` restores real modules before every test.

**Rules:**

1. Never call `mock.module()` at file top-level — always inside `describe`-level `beforeEach`
2. Never call `mockLogger()` / `setupTestDb()` / `mockMessageCache()` at file top-level
3. No `afterAll(() => { mock.restore() })` needed — global `afterEach` handles it
4. Adding a new mocked module? Add it to `tests/mock-reset.ts` originals list

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

### Dependency Injection Pattern

Modules should export a `Deps` interface and accept an optional `deps` parameter for testability:

```typescript
// Source module exports Deps interface
export interface SomeDeps {
  dependency: () => ReturnType
}

const defaultDeps: SomeDeps = {
  dependency: () => realImplementation(),
}

export function someFunction(input: Input, deps: SomeDeps = defaultDeps): Output {
  return deps.dependency()
}

// Tests pass fakes directly without mock.module()
const deps: SomeDeps = { dependency: (): ReturnType => fakeValue }
someFunction(input, deps)
```

## Path-Scoped Conventions

Detailed conventions live in subdirectory `CLAUDE.md` files (loaded by Claude Code and opencode) and `.github/instructions/*.instructions.md` files (loaded by GitHub Copilot):

| Path                      | Covers                                                            |
| ------------------------- | ----------------------------------------------------------------- |
| `src/providers/CLAUDE.md` | TaskProvider interface, operations, schemas, error classification |
| `src/tools/CLAUDE.md`     | Tool definitions, capability gating, destructive actions          |
| `src/commands/CLAUDE.md`  | Command handler pattern, auth checks, ReplyFn                     |
| `src/chat/CLAUDE.md`      | ChatProvider interface, platform adapters                         |
| `tests/CLAUDE.md`         | Test helpers, mocking rules, mock pollution, E2E testing          |
