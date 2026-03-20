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

### Getting API Keys

#### Telegram Bot Token

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Start a chat and send `/newbot`
3. Follow prompts to name your bot (e.g., "papai") and choose a username (e.g., `papai_bot`)
4. BotFather will provide a token like: `123456789:ABCdefGHIjklMNOpqrSTUvwxyz123456789`
5. Copy this token to `TELEGRAM_BOT_TOKEN`
6. **Getting your user ID**: Send a message to [@userinfobot](https://t.me/userinfobot) to get your numeric user ID for `ADMIN_USER_ID`

#### Mattermost Bot Token

1. In Mattermost, go to **Main Menu → Integrations → Bot Accounts**
2. Click **Add Bot Account**
3. Fill in details:
   - Username: `papai`
   - Display Name: `papai Bot`
   - Description: `Task management bot`
4. Set **Role** to `System Admin` (or ensure the bot can post in channels)
5. Save and copy the **Token** (starts with `q` or similar)
6. Set `MATTERMOST_URL` to your instance (e.g., `https://mattermost.company.com`)
7. **Getting your user ID**: In Mattermost, go to **Account Settings → Security → View Access History** or use the API; your user ID is the string shown in your profile URL or use `/user add @yourusername` after starting the bot

#### Kaneo API Key

Kaneo is self-hosted. After setting up your instance:

1. Log into Kaneo web UI
2. Go to **Settings → API Keys**
3. Click **Create API Key** and copy the key
4. Alternatively, Kaneo auto-provisions on first use if you use email/password

**Self-hosting Kaneo** (optional):

```bash
git clone https://github.com/usekaneo/kaneo.git
cd kaneo
cp .env.example .env
# Edit .env with your settings
docker compose up -d
```

#### YouTrack Token

1. Log into your YouTrack instance
2. Click your avatar → **Profile** → **Account Settings**
3. Go to **Authentication → Hub Tokens**
4. Click **New token...**
5. Name it "papai" and grant permissions:
   - **YouTrack**: Read issues, Update issues, Read projects, Create issues
   - **Hub**: Read user profile
6. Copy the token (starts with `perm:`)
7. Set `youtrack_url` to your instance (e.g., `https://youtrack.company.com`)

#### LLM API Key

For OpenAI-compatible providers:

- **OpenAI**: Get from [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- **Anthropic**: Get from [console.anthropic.com](https://console.anthropic.com)
- **OpenRouter**: Get from [openrouter.ai/keys](https://openrouter.ai/keys)
- **Local (Ollama)**: Use any non-empty value (e.g., `ollama`) since local endpoints often don't require auth
- **OpenAI-compatible**: Check your provider's documentation

### Runtime Configuration

After the bot starts, configure per-user settings via chat commands:

**Common settings** (all providers):

| Key           | Description                       | Example                            |
| ------------- | --------------------------------- | ---------------------------------- |
| `provider`    | Task tracker backend              | `kaneo` or `youtrack`              |
| `llm_apikey`  | LLM provider API key              | `sk-...` or `any-value-for-local`  |
| `llm_baseurl` | OpenAI-compatible base URL        | `https://api.openai.com/v1`        |
| `main_model`  | Primary model for task operations | `gpt-4o`, `claude-3-opus-20240229` |
| `small_model` | Model for memory extraction (opt) | `gpt-4o-mini`                      |

**Kaneo-specific:**

| Key            | Description         | Example             |
| -------------- | ------------------- | ------------------- |
| `kaneo_apikey` | Kaneo API key/token | From Kaneo Settings |

**YouTrack-specific:**

| Key              | Description           | Example                        |
| ---------------- | --------------------- | ------------------------------ |
| `youtrack_url`   | YouTrack instance URL | `https://youtrack.example.com` |
| `youtrack_token` | Permanent token       | `perm:XXX...`                  |

Use `/config` to view current values, and `/set <key> <value>` to update them.

### Configuration Examples

#### Example 1: Telegram + OpenAI + Kaneo

```bash
# .env - Required startup variables
CHAT_PROVIDER=telegram
ADMIN_USER_ID=123456789
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxyz123456789
```

Then via chat:

```
/set provider kaneo
/set kaneo_apikey your_kaneo_api_key
/set llm_apikey sk-your-openai-key
/set llm_baseurl https://api.openai.com/v1
/set main_model gpt-4o
```

#### Example 2: Mattermost + OpenRouter + YouTrack

```bash
# .env - Required startup variables
CHAT_PROVIDER=mattermost
ADMIN_USER_ID=your-mattermost-username
MATTERMOST_URL=https://mattermost.company.com
MATTERMOST_BOT_TOKEN=q1w2e3r4t5y6u7i8o9p0
```

Then via chat:

```
/set provider youtrack
/set youtrack_url https://youtrack.company.com
/set youtrack_token perm:your-youtrack-token
/set llm_apikey sk-or-v1-your-openrouter-key
/set llm_baseurl https://openrouter.ai/api/v1
/set main_model anthropic/claude-3-opus
```

#### Example 3: Telegram + Local Ollama + Kaneo

```bash
# .env
CHAT_PROVIDER=telegram
ADMIN_USER_ID=123456789
TELEGRAM_BOT_TOKEN=your-telegram-token
```

Then via chat:

```
/set provider kaneo
/set kaneo_apikey your_kaneo_key
/set llm_apikey ollama
/set llm_baseurl http://localhost:11434/v1
/set main_model qwen3:8b
```

#### Example 4: Full Docker Compose with Kaneo

```yaml
# docker-compose.yml
services:
  papai:
    image: ghcr.io/wkich/papai:latest
    environment:
      CHAT_PROVIDER: telegram
      ADMIN_USER_ID: '123456789'
      TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN}
      KANEO_CLIENT_URL: https://kaneo.example.com
    volumes:
      - papai-data:/data

volumes:
  papai-data:
```

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

## Group Chat Support

The bot can be added to Telegram groups or Mattermost channels for team collaboration.

### Quick Start

1. Add bot to your group
2. Group admin runs: `/group adduser @username` to authorize members
3. Group admin configures: `/set provider kaneo`, `/set llm_apikey ...`
4. Members mention: `@bot create task: fix bug`

### Authorization

- **Group Admin**: Full access (add/remove members, configure bot)
- **Group Member**: Natural language queries via mention only
- **Non-Member**: Gets auth error when mentioning bot

### Commands

| Command                              | In Group | Who Can Run               |
| ------------------------------------ | -------- | ------------------------- |
| `/group adduser/deluser`             | ✓        | Group Admin               |
| `/group users`                       | ✓        | Any Member                |
| `/set`, `/config`, `/clear`, `/help` | ✓        | Group Admin only          |
| Natural language                     | ✓        | Any Member (with mention) |
| `/user`, `/users`                    | ✗        | DM only                   |

### Important Notes

- In groups, natural language queries require mentioning the bot (e.g., "@bot create a task")
- Commands like `/set` and `/clear` work without mentions but require admin privileges
- Each group has isolated conversation history and configuration
- Group members are managed independently from bot administrators

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

All scripts can be run with `bun <script>` (no `run` keyword needed):

```bash
bun lint          # lint with oxlint
bun lint:fix      # lint with auto-fix
bun format        # format with oxfmt
bun format:check  # check formatting without writing
bun knip          # check for unused dependencies/exports
bun typecheck     # TypeScript type checking
bun security      # run Semgrep security scan locally
bun security:ci   # run security scan with JSON/SARIF output for CI
bun check         # run all checks in parallel (lint, typecheck, format:check, knip, test, security)
bun fix           # auto-fix lint and format issues
```

No build step — Bun runs TypeScript directly.

## Testing

Tests are organized in the `tests/` directory, mirroring the `src/` structure:

```
tests/
├── *.test.ts              # Unit tests
├── providers/             # Tests for src/providers/*
│   ├── kaneo/
│   └── youtrack/
├── tools/                 # Tests for src/tools/*
└── e2e/                   # E2E tests (require Docker)
```

### Running Tests

**Unit tests** (excludes E2E tests):

```bash
bun test           # or: bun run test
```

**E2E tests** (requires Docker):

```bash
bun test:e2e       # or: bun run test:e2e
```

The `bunfig.toml` is configured with `pathIgnorePatterns` to exclude E2E tests from the default `bun test` command. E2E tests require Docker to spin up a Kaneo instance and therefore must be run separately via `bun test:e2e`.

### Test Configuration

Tests use `bunfig.toml` for configuration:

- `pathIgnorePatterns` excludes `tests/e2e/**` from default test discovery
- E2E tests override this with `--path-ignore-patterns ''` to run the E2E suite

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
