# papai

Chat bot that manages tasks via natural language, powered by any OpenAI-compatible LLM. Supports Telegram and Mattermost as chat platforms, and multiple task tracker backends (Kaneo, YouTrack) via a unified provider abstraction.

## Features

- **Task creation** — create tasks with title, description, priority, project, due date, labels, and status
- **Task updates** — change status, priority, assignee, due date, title, description, or labels
- **Search** — find tasks by keyword
- **Task details** — fetch full details of any task including relations
- **Comments** — add, read, update, and remove comments on tasks (provider-dependent)
- **Labels** — list, create, update, and apply labels to tasks (provider-dependent)
- **Relations** — create and view blocks/duplicate/related relations between tasks (provider-dependent)
- **Projects** — list, create, and update projects in your workspace (provider-dependent)
- **Statuses** — manage kanban board statuses (create, update, delete, reorder) (provider-dependent)
- **Auto-provisioning** — automatic Kaneo account creation on first use (Kaneo provider only)
- **Conversation memory** — maintains per-user chat history with smart trimming and rolling summaries for multi-turn interactions
- **Long-term memory** — extracts and persists facts from tool results for better context
- **Multi-platform** — runs on Telegram or Mattermost via a single `CHAT_PROVIDER` env var
- **Multi-provider support** — switch between Kaneo, YouTrack, or future providers per user via `/set provider <name>`
- **Multi-user support** — admin can authorize multiple users, each with isolated credentials and conversation history

## Prerequisites

- [Bun](https://bun.sh) runtime
- A supported chat platform: [Telegram](https://telegram.org) (bot token from [@BotFather](https://t.me/BotFather)) or [Mattermost](https://mattermost.com) (bot account + token)
- A supported task tracker instance: [Kaneo](https://github.com/usekaneo/kaneo) (self-hosted) or [YouTrack](https://www.jetbrains.com/youtrack/)
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

| Variable        | Description                                                                                |
| --------------- | ------------------------------------------------------------------------------------------ |
| `CHAT_PROVIDER` | Chat platform to use: `telegram` or `mattermost`                                           |
| `ADMIN_USER_ID` | Admin user ID (numeric for Telegram, string for Mattermost). Auto-authorized on first run. |

**Telegram-specific** (required when `CHAT_PROVIDER=telegram`):

| Variable             | Description            | Where to get it                      |
| -------------------- | ---------------------- | ------------------------------------ |
| `TELEGRAM_BOT_TOKEN` | Telegram bot API token | [@BotFather](https://t.me/BotFather) |

**Mattermost-specific** (required when `CHAT_PROVIDER=mattermost`):

| Variable               | Description               | Where to get it                          |
| ---------------------- | ------------------------- | ---------------------------------------- |
| `MATTERMOST_URL`       | Mattermost instance URL   | Your Mattermost deployment URL           |
| `MATTERMOST_BOT_TOKEN` | Mattermost bot user token | Mattermost → Integrations → Bot Accounts |

The remaining credentials are configured at runtime via the `/set` command:

**Common settings:**

| Key           | Description                           | Example / Where to get it                                           |
| ------------- | ------------------------------------- | ------------------------------------------------------------------- |
| `provider`    | Task tracker backend to use           | `kaneo` (default) or `youtrack`                                     |
| `llm_apikey`  | API key for your LLM provider         | Your provider's API key (use any value for keyless local endpoints) |
| `llm_baseurl` | OpenAI-compatible base URL            | e.g. `https://api.openai.com/v1`, `http://localhost:11434/v1`       |
| `main_model`  | Model name to use                     | e.g. `gpt-4o`, `claude-opus-4-6`, `qwen3:8b`                        |
| `small_model` | Optional: model for memory extraction | Same as `main_model` if not specified                               |

**Kaneo provider (default):**

| Key            | Description                    | Where to get it                                |
| -------------- | ------------------------------ | ---------------------------------------------- |
| `kaneo_apikey` | Kaneo API key or session token | Kaneo Settings → API Keys, or auto-provisioned |

**YouTrack provider:**

| Key              | Description              | Example                         |
| ---------------- | ------------------------ | ------------------------------- |
| `youtrack_url`   | YouTrack instance URL    | `https://youtrack.example.com`  |
| `youtrack_token` | YouTrack permanent token | YouTrack → Profile → Hub Tokens |

Use `/config` to view current values, and `/set <key> <value>` to update them. Each user's credentials are isolated.

### Admin Commands

The admin user (from `ADMIN_USER_ID`) can manage authorized users:

| Command                        | Description                            |
| ------------------------------ | -------------------------------------- |
| `/user add <id\|@username>`    | Authorize a new user by ID or username |
| `/user remove <id\|@username>` | Revoke a user's access                 |
| `/users`                       | List all authorized users              |

## Usage

Send natural language messages to the bot:

- **"Create a bug report: login page crashes on Safari"** — creates a new task
- **"What tasks are in progress?"** — searches tasks by keyword
- **"Move task 42 to Done"** — updates a task's status
- **"List all projects"** — shows available projects
- **"Create a high-priority task in the Backend project: fix API timeout"** — creates a task with priority and project
- **"Show me the details of task 42"** — fetches full task details with relations
- **"Add a comment to task 42: blocked by the auth refactor"** — adds a comment
- **"What labels are available?"** — lists all workspace labels
- **"Mark task 42 as blocking task 55"** — creates a blocks relation
- **"Set the due date on task 42 to March 15"** — updates the due date
- **"Create a new status called Review in the Frontend project"** — manages kanban statuses
- **"Archive task 42"** — archives a completed task
- **"Delete task 42"** — permanently deletes a task (provider-dependent)

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

| Path                        | Role                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/index.ts`              | Entry point; validates env vars, runs migrations, creates `ChatProvider`, starts the bot                   |
| `src/bot.ts`                | Platform-agnostic wiring; registers all command and message handlers via `setupBot(chat, adminUserId)`     |
| `src/chat/types.ts`         | `ChatProvider` interface, `ReplyFn`, `IncomingMessage`, `ChatUser`, `ChatFile` types                       |
| `src/chat/registry.ts`      | Provider factory; `createChatProvider(name)` instantiates the named chat provider                          |
| `src/chat/telegram/`        | Grammy-based Telegram adapter (`TelegramChatProvider`); `format.ts` converts markdown to Telegram entities |
| `src/chat/mattermost/`      | Mattermost REST+WebSocket adapter (`MattermostChatProvider`)                                               |
| `src/llm-orchestrator.ts`   | LLM orchestration; calls Vercel AI SDK with capability-gated tools, sends reply via `ReplyFn`              |
| `src/config.ts`             | SQLite-backed per-user runtime config store                                                                |
| `src/users.ts`              | User authorization store; admin commands for adding/removing users                                         |
| `src/errors.ts`             | Discriminated union error types, constructors, and user-facing message mapper                              |
| `src/tools/`                | One file per tool; `index.ts` assembles capability-gated tools via `makeTools(provider)`                   |
| `src/providers/types.ts`    | `TaskProvider` interface, `Capability` types, normalized domain types                                      |
| `src/providers/registry.ts` | Provider factory; `createProvider(name, config)` instantiates the named task provider                      |
| `src/providers/kaneo/`      | Kaneo REST API adapter (`KaneoProvider`); HTTP client, error classifier, schemas                           |
| `src/providers/youtrack/`   | YouTrack REST API adapter (`YouTrackProvider`); schemas, mappers, operations                               |
| `src/commands/`             | Platform-agnostic command handlers: `/help`, `/set`, `/config`, `/clear`, `/context`, admin                |
| `src/conversation.ts`       | Conversation history management with smart trimming and rolling summaries                                  |
| `src/history.ts`            | Persistent conversation history storage (SQLite-backed per-user)                                           |
| `src/memory.ts`             | Fact extraction and persistence from tool results for long-term context                                    |
| `src/logger.ts`             | pino logger instance                                                                                       |

## Tech Stack

- **Runtime** — [Bun](https://bun.sh)
- **Chat platforms** — [Grammy](https://grammy.dev) (Telegram), Mattermost REST API v4 + WebSocket
- **LLM integration** — [Vercel AI SDK](https://sdk.vercel.ai) via `@ai-sdk/openai-compatible`
- **Task trackers** — [Kaneo](https://github.com/usekaneo/kaneo) REST API, [YouTrack](https://www.jetbrains.com/youtrack/) REST API
- **Validation** — [Zod v4](https://zod.dev)
- **Linting/formatting** — oxlint / oxfmt
- **Security scanning** — Semgrep (OWASP Top 10, JS/TS best practices, AI/LLM issues)
- **Dead code detection** — Knip

## Deployment

### Automated (GitHub Actions)

Publishing a GitHub release triggers the deploy workflow, which builds a Docker image, pushes it to GHCR, and deploys to a remote server via SSH.

**Required GitHub secrets:**

| Secret               | Description                                               |
| -------------------- | --------------------------------------------------------- |
| `SSH_KEY`            | Private SSH key for the deploy target                     |
| `SSH_HOST_KEY`       | Server's public host key (output of `ssh-keyscan <host>`) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot API token                                    |
| `ADMIN_USER_ID`      | Admin user ID (numeric Telegram user ID)                  |

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
CHAT_PROVIDER=telegram
ADMIN_USER_ID=<your-user-id>
TELEGRAM_BOT_TOKEN=<your-bot-token>
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
# Edit .env with your CHAT_PROVIDER, ADMIN_USER_ID, and platform-specific token
bun run start
```

After starting, configure credentials via the bot:

```
/set kaneo_apikey <your-kaneo-api-key>
/set llm_apikey sk-xxxxxxxxxxxx
/set llm_baseurl https://api.openai.com/v1
/set main_model gpt-4o
```

## Development

```bash
bun run lint      # lint with oxlint
bun run format    # format with oxfmt
bun run test      # run tests with bun
bun run knip      # check for unused dependencies/exports
bun run typecheck # TypeScript type checking
bun run security  # run Semgrep security scan
```

No build step — Bun runs TypeScript directly.

## Testing

Tests are organized in the `tests/` directory, mirroring the `src/` structure:

```
tests/
├── *.test.ts              # Unit tests (run with bun run test)
├── providers/             # Tests for src/providers/*
│   ├── kaneo/
│   └── youtrack/
├── tools/                 # Tests for src/tools/*
└── e2e/                   # E2E tests (run with bun run test:e2e)
```

Run tests with `bun test` or `bun run test`.

## Releasing

To create a new release:

1. Go to GitHub Actions → Release workflow
2. Click "Run workflow"
3. Select bump type (patch/minor/major)
4. The workflow will:
   - Generate changelog from conventional commits
   - Commit CHANGELOG.md
   - Create git tag
   - Publish GitHub release
   - Trigger deployment

### Local Development

> **Prerequisite:** [`git-cliff`](https://git-cliff.org/docs/installation) must be installed and available on your `PATH`.

Preview changelog without releasing:

```bash
bun run changelog:preview
```

Generate changelog locally:

```bash
bun run changelog:generate
```
