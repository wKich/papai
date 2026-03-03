# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

papai is a Telegram bot that manages Linear tasks via LLM tool-calling. A user sends natural language messages through Telegram, the bot invokes GPT-4o (via Vercel AI SDK) which autonomously selects and executes Linear operations, then replies with the result.

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
Telegram user ─→ Grammy bot (bot.ts) ─→ Vercel AI SDK generateText (GPT-4o)
                                              │
                                              ├─ tools (tools.ts) ─→ Linear SDK (linear.ts)
                                              │   create_issue, update_issue,
                                              │   search_issues, list_projects
                                              │
                                              └─→ response back to Telegram
```

- **`src/index.ts`** — entry point; validates env vars, starts the bot.
- **`src/bot.ts`** — Grammy bot setup, per-user conversation history (capped at 40 messages), LLM orchestration with up to 5 tool-calling steps. Only processes messages from the authorized `TELEGRAM_USER_ID`.
- **`src/config.ts`** — SQLite-backed runtime config store; exposes `getConfig`, `setConfig`, `getAllConfig`; handles `/set` and `/config` bot commands.
- **`src/tools.ts`** — Zod-validated tool definitions exposed to the LLM.
- **`src/linear.ts`** — Linear SDK wrapper functions called by the tools.
- **`src/logger.ts`** — pino logger instance shared across all modules.

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

- All function entries in `linear.ts`
- All tool executions in `tools.ts`
- Message lifecycle in `bot.ts` (receive, process, respond)
- Authorization checks
- Error catch blocks

## Key Conventions

- Runtime: **Bun** (not Node)
- Validation: **Zod v4** for all schemas
- LLM integration: **Vercel AI SDK** (`ai` package) with `@ai-sdk/openai`
- Bot framework: **Grammy**
- Linting/formatting: **oxlint / oxfmt** (not ESLint/Prettier)
- Strict TypeScript (`tsconfig.json` has strict mode + all safety flags)
- Logging: **pino** with structured JSON output
