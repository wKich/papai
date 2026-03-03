# papai

Telegram bot that manages Linear tasks via natural language, powered by GPT-4o tool-calling.

## Features

- **Issue creation** — create issues with title, description, priority, project, due date, labels, and estimate
- **Issue updates** — change status, assignee, due date, labels, or estimate
- **Search** — find issues by keyword or filter by workflow state
- **Issue details** — fetch full details of any issue
- **Comments** — add and read comments on issues
- **Labels** — list, create, and apply labels when creating or updating issues
- **Relations** — create and view blocks/duplicate/related relations between issues
- **Projects** — list all teams and projects, or create new projects
- **Conversation memory** — maintains per-user chat history (last 40 messages) for multi-turn interactions
- **Single-user auth** — restricts access to a single authorized Telegram user

## Prerequisites

- [Bun](https://bun.sh) runtime
- Telegram bot token (from [@BotFather](https://t.me/BotFather))
- [Linear](https://linear.app) API key
- [OpenAI](https://platform.openai.com) API key

## Setup

```bash
git clone https://github.com/wKich/papai.git
cd papai
bun install
cp .env.example .env
# Fill in your environment variables (see below)
bun run start
```

## Environment Variables

Two variables are required at startup:

| Variable             | Description                    | Where to get it                          |
| -------------------- | ------------------------------ | ---------------------------------------- |
| `TELEGRAM_BOT_TOKEN` | Telegram bot API token         | [@BotFather](https://t.me/BotFather)     |
| `TELEGRAM_USER_ID`   | Your personal Telegram user ID | [@userinfobot](https://t.me/userinfobot) |

The remaining credentials are configured at runtime via the `/set` command:

| Key               | Description                        | Where to get it                                                      |
| ----------------- | ---------------------------------- | -------------------------------------------------------------------- |
| `linear_key`      | Linear personal API key            | Linear Settings → API → Personal API keys                            |
| `linear_team_id`  | Default team ID for issue creation | Run `list_projects` in the bot, or find it in Linear URL             |
| `openai_key`      | OpenAI API key                     | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `openai_base_url` | Custom OpenAI-compatible base URL  | Optional; defaults to OpenAI                                         |
| `openai_model`    | Model name to use                  | Optional; defaults to `gpt-4o`                                       |

Use `/config` to view current values, and `/set <key> <value>` to update them.

## Usage

Send natural language messages to the bot in Telegram:

- **"Create a bug report: login page crashes on Safari"** — creates a new issue
- **"What tasks are in progress?"** — searches issues filtered by state
- **"Move PAP-42 to Done"** — updates an issue's workflow state
- **"List all projects"** — shows available teams and projects
- **"Create a high-priority task in the Backend project: fix API timeout"** — creates an issue with priority and project
- **"Show me the details of PAP-42"** — fetches full issue details
- **"Add a comment to PAP-42: blocked by the auth refactor"** — adds a comment
- **"What labels are available?"** — lists all team labels
- **"Mark PAP-42 as blocking PAP-55"** — creates a blocks relation
- **"Set the due date on PAP-42 to March 15"** — updates the due date

## Architecture

```
Telegram user ─→ Grammy bot (bot.ts) ─→ Vercel AI SDK generateText (GPT-4o)
                                              │
                                              ├─ src/tools/ ─→ src/linear/ ─→ Linear SDK
                                              │   13 tools, one file each
                                              │
                                              └─→ response back to Telegram
```

| Path            | Role                                                                                   |
| --------------- | -------------------------------------------------------------------------------------- |
| `src/index.ts`  | Entry point; validates env vars, starts the bot                                        |
| `src/bot.ts`    | Grammy bot setup, conversation history, LLM orchestration (up to 5 tool-calling steps) |
| `src/config.ts` | SQLite-backed runtime config store; `/set` and `/config` command handlers              |
| `src/errors.ts` | Discriminated union error types, constructors, and user-facing message mapper          |
| `src/tools/`    | One file per tool; `index.ts` assembles all 13 into `makeTools`                        |
| `src/linear/`   | One file per Linear SDK wrapper; `index.ts` re-exports all 13                          |
| `src/logger.ts` | pino logger instance                                                                   |

## Tech Stack

- **Runtime** — [Bun](https://bun.sh)
- **Bot framework** — [Grammy](https://grammy.dev)
- **LLM integration** — [Vercel AI SDK](https://sdk.vercel.ai) with GPT-4o via `@ai-sdk/openai`
- **Task management** — [Linear SDK](https://developers.linear.app/docs/sdk/getting-started)
- **Validation** — [Zod v4](https://zod.dev)
- **Linting/formatting** — oxlint / oxfmt

## Development

```bash
bun run lint      # lint with oxlint
bun run format    # format with oxfmt
```

No build step — Bun runs TypeScript directly.
