# papai

Telegram bot that manages Linear tasks via natural language, powered by GPT-4o tool-calling.

## Features

- **Issue creation** — create Linear issues with title, description, priority, and project association
- **Issue updates** — change issue status and assignee
- **Search** — find issues by keyword or filter by workflow state
- **Project listing** — list all teams and projects for context
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

| Variable | Description | Where to get it |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Telegram bot API token | [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_USER_ID` | Your personal Telegram user ID | [@userinfobot](https://t.me/userinfobot) |
| `LINEAR_API_KEY` | Linear personal API key | Linear Settings → API → Personal API keys |
| `LINEAR_TEAM_ID` | Default team ID for issue creation | Run `list_projects` in the bot, or find it in Linear URL |
| `OPENAI_API_KEY` | OpenAI API key | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |

## Usage

Send natural language messages to the bot in Telegram:

- **"Create a bug report: login page crashes on Safari"** — creates a new issue
- **"What tasks are in progress?"** — searches issues filtered by state
- **"Move PAP-42 to Done"** — updates an issue's workflow state
- **"List all projects"** — shows available teams and projects
- **"Create a high-priority task in the Backend project: fix API timeout"** — creates an issue with priority and project

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

| File | Role |
|---|---|
| `src/index.ts` | Entry point; validates env vars, starts the bot |
| `src/bot.ts` | Grammy bot setup, conversation history, LLM orchestration (up to 5 tool-calling steps) |
| `src/tools.ts` | Zod-validated tool definitions exposed to the LLM |
| `src/linear.ts` | Linear SDK wrapper functions called by the tools |

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
