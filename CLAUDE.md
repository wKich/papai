# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

papai is a Telegram bot that manages Linear tasks via LLM tool-calling. A user sends natural language messages through Telegram, the bot invokes a configurable OpenAI-compatible LLM (via Vercel AI SDK) which autonomously selects and executes Linear operations, then replies with the result. The provider, base URL, and model are all runtime-configurable — any OpenAI-compatible endpoint works (OpenAI, Anthropic, Mistral, Ollama, etc.).

## Commands

- `bun run start` — run the bot (`bun run src/index.ts`)
- `bun run lint` — lint with oxlint
- `bun run format` — format with oxfmt
- `bun install` — install dependencies

No build step; Bun runs TypeScript directly.

## Required Environment Variables

Copy `.env.example` to `.env`. Only two are required at startup (validated in `src/index.ts`):
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_USER_ID`

The remaining credentials (`linear_key`, `linear_team_id`, `openai_key`, `openai_base_url`, `openai_model`) are stored in a local SQLite database and configured at runtime via the `/set <key> <value>` Telegram command. Use `/config` to view current values.

## Architecture

```
Telegram user ─→ Grammy bot (bot.ts) ─→ Vercel AI SDK generateText (any OpenAI-compatible LLM)
                                              │
                                              ├─ tools/ ─→ linear/ ─→ Linear SDK
                                              │   22 tools, one file each
                                              │
                                              └─→ response back to Telegram
```

- **`src/index.ts`** — entry point; validates env vars, starts the bot.
- **`src/bot.ts`** — Grammy bot setup, per-user conversation history (capped at 40 messages), LLM orchestration with up to 5 tool-calling steps. Only processes messages from the authorized `TELEGRAM_USER_ID`.
- **`src/config.ts`** — SQLite-backed runtime config store; exposes `getConfig`, `setConfig`, `getAllConfig`; handles `/set` and `/config` bot commands.
- **`src/errors.ts`** — Discriminated union error types (`AppError`), constructors, and `getUserMessage` mapper. `isAppError` uses Zod runtime validation.
- **`src/tools/`** — One file per tool. `index.ts` assembles all 22 into `makeTools`. Each tool imports its corresponding linear function.
- **`src/linear/`** — One file per Linear SDK wrapper function. `index.ts` re-exports all 22. `classify-error.ts` contains the shared error classifier.
- **`src/logger.ts`** — pino logger instance shared across all modules.

### Available tools

| Tool                    | Description                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `create_issue`          | Create a new issue (supports title, description, priority, project, due date, labels, estimate) |
| `update_issue`          | Update status, assignee, due date, labels, or estimate on an existing issue                     |
| `search_issues`         | Search issues by keyword, optionally filtered by state                                          |
| `get_issue`             | Fetch full details of a single issue including labels and relations                             |
| `archive_issue`         | Archive an issue                                                                                |
| `add_issue_comment`     | Add a Markdown comment to an issue                                                              |
| `get_issue_comments`    | Read all comments on an issue                                                                   |
| `update_issue_comment`  | Update an existing comment on an issue                                                          |
| `remove_issue_comment`  | Remove a comment from an issue                                                                  |
| `list_projects`         | List all teams and their projects                                                               |
| `create_project`        | Create a new project in the team                                                                |
| `update_project`        | Update an existing project (name, description)                                                  |
| `archive_project`       | Archive a project                                                                               |
| `list_labels`           | List all available labels in the team                                                           |
| `create_label`          | Create a new label with optional hex color                                                      |
| `update_label`          | Update an existing label (name, description, color)                                             |
| `remove_label`          | Remove (delete) a label                                                                         |
| `add_issue_label`       | Add a label to an issue                                                                         |
| `remove_issue_label`    | Remove a label from an issue                                                                    |
| `add_issue_relation`    | Create a blocks/duplicate/related relation between two issues                                   |
| `update_issue_relation` | Update the type of an existing relation between two issues                                      |
| `remove_issue_relation` | Remove a relation between two issues                                                            |

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

- Successful completion of major operations (issue created/updated, search completed)
- External service calls with result summaries
- User session lifecycle events
- Example: `logger.info({ issueId, identifier }, 'Issue created')`

#### `logger.warn()` — Unexpected but recoverable

Use for:

- Invalid input that won't crash the app
- Missing optional data
- Failed lookups (workflow states not found)
- Resource limits reached (history truncation)
- Unauthorized access attempts
- API returning incomplete data
- Example: `logger.warn({ issueId, requestedStatus }, 'Workflow state not found')`

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

- All function entries in `src/linear/`
- All tool executions in `src/tools/`
- Message lifecycle in `bot.ts` (receive, process, respond)
- Authorization checks
- Error catch blocks

## Testing

Tests are located in the `tests/` directory with the same structure as `src/`:

```
tests/
├── bot.test.ts
├── config.test.ts
├── errors.test.ts
├── logger.test.ts
├── linear/           # Tests for src/linear/*
└── tools/            # Tests for src/tools/*
```

Run tests with `bun test` or `bun run test`.

## Key Conventions

- Runtime: **Bun** (not Node)
- Validation: **Zod v4** for all schemas
- LLM integration: **Vercel AI SDK** (`ai` package) with `@ai-sdk/openai`
- Bot framework: **Grammy**
- Linting/formatting: **oxlint / oxfmt** (not ESLint/Prettier)
- Strict TypeScript (`tsconfig.json` has strict mode + all safety flags)
- Logging: **pino** with structured JSON output
- Tests: Located in `tests/` directory, mirroring `src/` structure
