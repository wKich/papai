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

Copy `.env.example` to `.env`. All five are required at startup (validated in `src/index.ts`):
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_USER_ID`, `LINEAR_API_KEY`, `LINEAR_TEAM_ID`, `OPENAI_API_KEY`

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
- **`src/tools.ts`** — Zod-validated tool definitions exposed to the LLM.
- **`src/linear.ts`** — Linear SDK wrapper functions called by the tools.

## Key Conventions

- Runtime: **Bun** (not Node)
- Validation: **Zod v4** for all schemas
- LLM integration: **Vercel AI SDK** (`ai` package) with `@ai-sdk/openai`
- Bot framework: **Grammy**
- Linting/formatting: **oxlint / oxfmt** (not ESLint/Prettier)
- Strict TypeScript (`tsconfig.json` has strict mode + all safety flags)
