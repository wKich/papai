# papai

Telegram bot that manages Linear tasks via natural language, powered by any OpenAI-compatible LLM.

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
- API key for any OpenAI-compatible LLM provider (OpenAI, Anthropic, Mistral, local Ollama, etc.)

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

| Key               | Description                        | Where to get it                                                           |
| ----------------- | ---------------------------------- | ------------------------------------------------------------------------- |
| `linear_key`      | Linear personal API key            | Linear Settings → API → Personal API keys                                 |
| `linear_team_id`  | Default team ID for issue creation | Run `list_projects` in the bot, or find it in Linear URL                  |
| `openai_key`      | API key for your LLM provider      | Your provider's API key (use any value for keyless local endpoints)       |
| `openai_base_url` | OpenAI-compatible base URL         | e.g. `https://api.openai.com/v1`, `http://localhost:11434/v1`             |
| `openai_model`    | Model name to use                  | e.g. `gpt-5.2`, `claude-opus-4-6`, `qwen3.5`, `kimi-k2.5`, `minimax-m2.5` |

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
Telegram user ─→ Grammy bot (bot.ts) ─→ Vercel AI SDK generateText (any OpenAI-compatible LLM)
                                              │
                                              ├─ src/tools/ ─→ src/linear/ ─→ Linear SDK
                                              │   15 tools, one file each
                                              │
                                              └─→ response back to Telegram
```

| Path            | Role                                                                                   |
| --------------- | -------------------------------------------------------------------------------------- |
| `src/index.ts`  | Entry point; validates env vars, starts the bot                                        |
| `src/bot.ts`    | Grammy bot setup, conversation history, LLM orchestration (up to 5 tool-calling steps) |
| `src/config.ts` | SQLite-backed runtime config store; `/set` and `/config` command handlers              |
| `src/errors.ts` | Discriminated union error types, constructors, and user-facing message mapper          |
| `src/tools/`    | One file per tool; `index.ts` assembles all 15 into `makeTools`                        |
| `src/linear/`   | One file per Linear SDK wrapper; `index.ts` re-exports all 15                          |
| `src/logger.ts` | pino logger instance                                                                   |

## Tech Stack

- **Runtime** — [Bun](https://bun.sh)
- **Bot framework** — [Grammy](https://grammy.dev)
- **LLM integration** — [Vercel AI SDK](https://sdk.vercel.ai) via `@ai-sdk/openai-compatible`
- **Task management** — [Linear SDK](https://developers.linear.app/docs/sdk/getting-started)
- **Validation** — [Zod v4](https://zod.dev)
- **Linting/formatting** — oxlint / oxfmt

## Deployment

### Automated (GitHub Actions)

Publishing a GitHub release triggers the deploy workflow, which builds a Docker image, pushes it to GHCR, and deploys to a remote server via SSH.

**Required GitHub secrets:**

| Secret               | Description                                               |
| -------------------- | --------------------------------------------------------- |
| `SSH_KEY`            | Private SSH key for the deploy target                     |
| `SSH_HOST_KEY`       | Server's public host key (output of `ssh-keyscan <host>`) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot API token                                    |
| `TELEGRAM_USER_ID`   | Your Telegram user ID                                     |

**Required GitHub variables:**

| Variable   | Description                         |
| ---------- | ----------------------------------- |
| `SSH_HOST` | Hostname or IP of the deploy target |
| `SSH_USER` | SSH username on the deploy target   |
| `SSH_PORT` | SSH port (defaults to `22`)         |

The workflow requires a `production` environment configured in GitHub repository settings.

To deploy, create a release (e.g., `v0.2`) on GitHub. The workflow will:

1. Build the Docker image and push to `ghcr.io/<owner>/papai`
2. SSH into the server, copy `docker-compose.yml`, write `.env`, and start the container

### Manual (Docker Compose)

On the target server:

```bash
# Log in to GHCR (if using the pre-built image)
echo "$GITHUB_TOKEN" | docker login ghcr.io -u <username> --password-stdin

# Create project directory
mkdir -p ~/papai && cd ~/papai

# Copy docker-compose.yml from the repo, then create .env
cat > .env <<EOF
TELEGRAM_BOT_TOKEN=<your-bot-token>
TELEGRAM_USER_ID=<your-user-id>
EOF
chmod 600 .env

# Pull and start
docker compose pull
docker compose up -d
```

The SQLite database is persisted in a Docker volume (`papai-data`) at `/data/papai.db`.

### Manual (bare metal)

```bash
git clone https://github.com/wKich/papai.git
cd papai
bun install
cp .env.example .env
# Edit .env with your TELEGRAM_BOT_TOKEN and TELEGRAM_USER_ID
bun run start
```

After starting, configure credentials via Telegram:

```
/set linear_key lin_api_xxxxxxxxxxxx
/set linear_team_id <team-id>
/set openai_key sk-xxxxxxxxxxxx
/set openai_base_url https://api.openai.com/v1
/set openai_model o3
```

## Development

```bash
bun run lint      # lint with oxlint
bun run format    # format with oxfmt
bun run test      # run tests with bun
```

No build step — Bun runs TypeScript directly.

## Testing

Tests are organized in the `tests/` directory, mirroring the `src/` structure:

```
tests/
├── bot.test.ts
├── config.test.ts
├── errors.test.ts
├── logger.test.ts
├── linear/
│   ├── add-comment.test.ts
│   ├── archive-issue.test.ts
│   ├── classify-error.test.ts
│   ├── create-issue.test.ts
│   └── ... (14 more)
└── tools/
    ├── create-issue.test.ts
    └── index.test.ts
```

Run all tests with `bun test` or `bun run test`.
