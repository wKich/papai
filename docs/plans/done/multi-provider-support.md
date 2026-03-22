# Multi-Provider Task Tracker Support

## Goal

Enable papai to work with multiple task tracker backends (Jira, Linear, Todoist, GitHub Issues, etc.) in addition to the existing Kaneo integration. Each user can configure which provider they use, and the LLM tools adapt accordingly.

---

## Current Architecture Analysis

### Coupling Points to Kaneo

The codebase is tightly coupled to Kaneo in **6 layers**:

| Layer                   | Files                                          | Coupling                                                                                                                     |
| ----------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **HTTP Client**         | `src/kaneo/client.ts`                          | `KaneoConfig`, `kaneoFetch()`, Kaneo-specific auth (Bearer + session cookie), `/api` path prefix                             |
| **Resource Classes**    | `src/kaneo/*-resource.ts`                      | Kaneo REST endpoints, request/response shapes, Zod schemas for Kaneo's API                                                   |
| **Domain Functions**    | `src/kaneo/create-task.ts`, etc. (28 files)    | Each instantiates `KaneoClient`, calls resource methods, catches and classifies errors                                       |
| **Error System**        | `src/errors.ts`, `src/kaneo/classify-error.ts` | `KaneoError` discriminated union, `classifyKaneoError()` maps HTTP status codes to domain errors                             |
| **Tools**               | `src/tools/*.ts` (28 files)                    | Each imports from `src/kaneo/index.js`, passes `KaneoConfig`, builds Kaneo-specific URLs                                     |
| **Bot / System Prompt** | `src/bot.ts`                                   | `buildKaneoConfig()`, `SYSTEM_PROMPT` references Kaneo columns/workspace concepts, `makeTools({ kaneoConfig, workspaceId })` |

### Kaneo-Specific Concepts

These concepts exist in Kaneo but may not have equivalents in other providers:

- **Workspace** — some providers use org/team instead, some have none
- **Columns** (kanban board layout) — Kaneo-specific; most providers use fixed statuses
- **Frontmatter-based relations** — a papai workaround because Kaneo lacks native relation support (`src/kaneo/frontmatter.ts` stores `blocks`/`blocked_by`/`duplicate`/`parent`/`related` in task descriptions)
- **Labels with hex colors** — common but not universal
- **Session cookie auth** — Kaneo's better-auth specific

### What's Already Provider-Agnostic

- **LLM integration** (`bot.ts` + Vercel AI SDK) — provider-agnostic by design; any `ToolSet` works
- **Config system** (`src/config.ts`) — per-user key-value store, easily extensible
- **User system** (`src/users.ts`) — not tied to Kaneo
- **Conversation/history/memory** — fully independent
- **Error type system** — `AppError` discriminated union already separates `kaneo` | `llm` | `validation` | `system`; adding a new provider type is straightforward

---

## Proposed Architecture

### Core Idea: Provider Interface + Capability-Based Tools

Instead of one monolithic tool set, define a **provider interface** with optional capabilities. Each provider implements what it supports, and tools are generated dynamically based on what the active provider offers.

### Provider Capabilities

Not all providers support all operations. Define capabilities as feature flags:

```
Core (required):
  - tasks.create, tasks.read, tasks.update, tasks.list, tasks.search

Optional:
  - tasks.archive
  - tasks.relations        (Kaneo via frontmatter, Linear natively, Jira natively)
  - projects.crud          (most providers)
  - comments.crud          (most providers)
  - labels.crud            (Kaneo, GitHub, Jira)
  - columns.crud           (Kaneo-specific, maybe Jira board configs)
  - statuses.list          (Linear, Jira — fixed status sets)
```

### Layer-by-Layer Changes

#### 1. New: Provider Interface (`src/providers/types.ts`)

Define a `TaskProvider` interface that each backend must implement:

```
TaskProvider {
  // Identity
  name: string                          // "kaneo", "linear", "jira", etc.
  capabilities: Set<Capability>         // what this provider supports

  // Core operations (all required)
  createTask(params): Promise<Task>
  getTask(id): Promise<Task>
  updateTask(id, params): Promise<Task>
  listTasks(projectId): Promise<Task[]>
  searchTasks(query): Promise<Task[]>

  // Optional operations (throw UnsupportedError if not in capabilities)
  archiveTask?(id): Promise<void>
  createProject?(params): Promise<Project>
  listProjects?(): Promise<Project[]>
  updateProject?(id, params): Promise<Project>
  archiveProject?(id): Promise<void>
  addComment?(taskId, body): Promise<Comment>
  getComments?(taskId): Promise<Comment[]>
  updateComment?(commentId, body): Promise<Comment>
  removeComment?(commentId): Promise<void>
  listLabels?(): Promise<Label[]>
  createLabel?(params): Promise<Label>
  addTaskLabel?(taskId, labelId): Promise<void>
  removeTaskLabel?(taskId, labelId): Promise<void>
  addRelation?(taskId, relatedId, type): Promise<void>
  removeRelation?(taskId, relatedId): Promise<void>
  listColumns?(projectId): Promise<Column[]>
  createColumn?(projectId, name): Promise<Column>
  // ... etc.

  // Provider-specific
  buildTaskUrl(taskId, projectId?): string
  buildProjectUrl(projectId): string
  classifyError(error: unknown): AppError
}
```

#### 2. New: Provider Registry (`src/providers/registry.ts`)

A factory that creates the correct provider instance based on user config:

```
registry.create(providerName, config) → TaskProvider
```

Supported providers are registered at startup. The registry maps `"kaneo"` → `KaneoProvider`, `"linear"` → `LinearProvider`, etc.

#### 3. Refactor: Kaneo as First Provider (`src/providers/kaneo/`)

Move existing `src/kaneo/` into `src/providers/kaneo/` and wrap it in a class implementing `TaskProvider`:

```
src/providers/
  types.ts              # TaskProvider interface, Capability enum, common types
  registry.ts           # Provider factory
  errors.ts             # ProviderError type (replaces KaneoError in AppError union)
  kaneo/
    index.ts            # KaneoProvider class implementing TaskProvider
    client.ts           # existing KaneoClient (unchanged internally)
    classify-error.ts   # existing (unchanged)
    frontmatter.ts      # existing (unchanged, Kaneo-specific)
    ...resources/       # existing resource classes
```

The existing `src/kaneo/` code moves largely as-is. `KaneoProvider` wraps it to conform to `TaskProvider`.

#### 4. Refactor: Tools Become Provider-Agnostic (`src/tools/`)

Tools stop importing from `src/kaneo/`. Instead, each tool receives a `TaskProvider` instance:

**Before:**

```typescript
import { createTask } from '../kaneo/index.js'
export function makeCreateTaskTool(kaneoConfig: KaneoConfig, workspaceId: string) {
  return tool({
    execute: async (params) => {
      const task = await createTask({ config: kaneoConfig, ...params })
    },
  })
}
```

**After:**

```typescript
export function makeCreateTaskTool(provider: TaskProvider) {
  return tool({
    execute: async (params) => {
      const task = await provider.createTask(params)
    },
  })
}
```

`makeTools()` signature changes:

**Before:** `makeTools({ kaneoConfig, workspaceId })`
**After:** `makeTools(provider: TaskProvider)`

Tools that depend on optional capabilities are only included if the provider supports them:

```typescript
function makeTools(provider: TaskProvider): ToolSet {
  const tools: ToolSet = {
    // Core — always present
    create_task: makeCreateTaskTool(provider),
    get_task: makeGetTaskTool(provider),
    update_task: makeUpdateTaskTool(provider),
    list_tasks: makeListTasksTool(provider),
    search_tasks: makeSearchTasksTool(provider),
  }

  // Conditional — based on capabilities
  if (provider.capabilities.has('comments.crud')) {
    tools.add_comment = makeAddCommentTool(provider)
    tools.get_comments = makeGetCommentsTool(provider)
    // ...
  }
  if (provider.capabilities.has('labels.crud')) {
    tools.list_labels = makeListLabelsTool(provider)
    // ...
  }
  // ...
  return tools
}
```

#### 5. Refactor: Error System (`src/errors.ts`)

Replace `KaneoError` with a generic `ProviderError`:

```
ProviderError =
  | { type: 'provider'; code: 'task-not-found'; taskId: string }
  | { type: 'provider'; code: 'project-not-found'; projectId: string }
  | { type: 'provider'; code: 'auth-failed' }
  | { type: 'provider'; code: 'rate-limited' }
  | { type: 'provider'; code: 'validation-failed'; field: string; reason: string }
  | { type: 'provider'; code: 'unsupported-operation'; operation: string }
  | { type: 'provider'; code: 'unknown'; originalError: Error }
  // ... same codes, just rename type from 'kaneo' to 'provider'

AppError = ProviderError | LlmError | ValidationError | SystemError
```

Each provider's `classifyError()` maps its native errors to `ProviderError`. User-facing messages stay generic ("Task not found" instead of "Kaneo task not found").

#### 6. Refactor: Config System (`src/config.ts`)

Add a `provider` config key:

```
ConfigKey = 'provider' | 'kaneo_apikey' | 'linear_apikey' | 'jira_apikey' | ...
            | 'llm_apikey' | 'llm_baseurl' | 'main_model' | 'small_model'
```

Each provider defines which config keys it needs. The `/set` command validates accordingly. The `/config` command shows only relevant keys for the active provider.

#### 7. Refactor: Bot Orchestration (`src/bot.ts`)

**Before:**

```typescript
const buildKaneoConfig = (userId: number): KaneoConfig => { ... }
const tools = makeTools({ kaneoConfig, workspaceId })
```

**After:**

```typescript
const buildProvider = (userId: number): TaskProvider => {
  const providerName = getConfig(userId, 'provider') ?? 'kaneo'
  const providerConfig = getProviderConfig(userId, providerName)
  return registry.create(providerName, providerConfig)
}
const provider = buildProvider(userId)
const tools = makeTools(provider)
```

#### 8. Refactor: System Prompt (`src/bot.ts`)

The system prompt currently hardcodes Kaneo concepts. Make it dynamic:

```typescript
const buildSystemPrompt = (provider: TaskProvider): string => {
  const base = `You are papai, a personal assistant that helps the user manage their ${provider.name} workspace from Telegram. ...`
  const capabilities = provider.getPromptAddendum() // Provider-specific instructions
  return base + capabilities
}
```

Each provider returns prompt additions explaining its concepts (e.g., Kaneo explains columns/kanban, Linear explains cycles/teams, Jira explains sprints/epics).

#### 9. New: Common Types (`src/providers/types.ts`)

Normalized domain objects that all providers map to:

```
Task     { id, title, description?, status?, priority?, assignee?, dueDate?, url, labels? }
Project  { id, name, description?, url }
Comment  { id, body, author?, createdAt? }
Label    { id, name, color? }
Column   { id, name, order? }
Relation { type, sourceTaskId, targetTaskId }
```

Providers map their native shapes to these common types. Tools always work with common types.

---

## Directory Structure (After)

```
src/
  providers/
    types.ts                # TaskProvider interface, Capability, common domain types
    registry.ts             # Factory: providerName → TaskProvider
    errors.ts               # ProviderError (replaces KaneoError)
    kaneo/                  # Existing code, reorganized
      index.ts              # KaneoProvider implements TaskProvider
      client.ts             # KaneoClient, kaneoFetch (unchanged)
      classify-error.ts     # Maps to ProviderError
      frontmatter.ts        # Kaneo-specific relation hack
      resources/            # TaskResource, ProjectResource, etc.
    linear/                 # Future provider
      index.ts              # LinearProvider implements TaskProvider
      client.ts
      ...
  tools/                    # Provider-agnostic tool definitions
    index.ts                # makeTools(provider) with capability checks
    create-task.ts          # Uses provider.createTask()
    ...
  bot.ts                    # Uses registry to build provider per-user
  config.ts                 # Extended with 'provider' key
  errors.ts                 # ProviderError replaces KaneoError
  ...
```

---

## Migration Strategy

### Phase 1: Extract Provider Interface (non-breaking)

1. Define `TaskProvider` interface and common types in `src/providers/types.ts`
2. Define `Capability` enum
3. Define `ProviderError` type (mirror of current `KaneoError` with `type: 'provider'`)

### Phase 2: Wrap Kaneo as Provider (non-breaking)

1. Create `src/providers/kaneo/index.ts` — `KaneoProvider` class that wraps existing `src/kaneo/` functions
2. KaneoProvider implements TaskProvider, delegates to existing code
3. Existing `src/kaneo/` code stays in place, KaneoProvider is a thin adapter
4. Create `src/providers/registry.ts` with just `kaneo` registered

### Phase 3: Rewire Tools (behavioral parity)

1. Change `makeTools()` to accept `TaskProvider` instead of `{ kaneoConfig, workspaceId }`
2. Update each tool file to call `provider.*` instead of importing from `src/kaneo/`
3. Add capability-gating in `makeTools()`
4. All 28 tools should produce identical behavior — this is a refactor, not a feature change

### Phase 4: Rewire Bot (behavioral parity)

1. Replace `buildKaneoConfig()` with `buildProvider()` using registry
2. Add `provider` config key, default to `'kaneo'`
3. Make system prompt dynamic based on provider
4. Update error handling to use `ProviderError` instead of `KaneoError`

### Phase 5: Clean Up

1. Move `src/kaneo/` contents into `src/providers/kaneo/` (or keep as-is with re-exports)
2. Update imports across the codebase
3. Remove `KaneoError` from `AppError`, fully replaced by `ProviderError`
4. Update tests to use provider interface

### Phase 6: Add Second Provider (validates the abstraction)

1. Pick a simple provider (e.g., Linear or GitHub Issues) as second implementation
2. Implement `TaskProvider` for it
3. Register in registry
4. Verify tools work without changes

---

## Design Decisions & Trade-offs

### Why an interface, not a plugin system?

A plugin system (dynamic loading, npm packages per provider) adds complexity we don't need yet. A simple interface with static registration keeps things simple. Can evolve to plugins later if needed.

### Why capability-based tools instead of per-provider tool sets?

Alternative: each provider defines its own tool set. Problem: duplicates Zod schemas and tool descriptions across providers. The LLM-facing tool interface is the same regardless of backend — "create a task" has the same parameters whether it's Kaneo or Jira. Only the implementation differs.

### What about provider-specific features?

Some providers have unique features (Jira sprints, Linear cycles, GitHub milestones). Options:

- **A)** Ignore them — only expose the common subset
- **B)** Allow providers to register extra tools via `provider.getExtraTools(): ToolSet`
- **Recommendation:** Start with A, add B when a concrete need arises. The common set (tasks, projects, comments, labels) covers 90% of use cases.

### What about the frontmatter hack?

The frontmatter system (`src/kaneo/frontmatter.ts`) stores relations in task descriptions because Kaneo lacks native relation support. This should stay as a Kaneo-specific implementation detail inside `KaneoProvider`. Providers with native relations (Linear, Jira) won't need it.

### What about URL building?

Each provider builds URLs differently. The `buildTaskUrl()` and `buildProjectUrl()` methods on `TaskProvider` handle this. Tools call `provider.buildTaskUrl(taskId)` instead of the current `buildTaskUrl(kaneoConfig.baseUrl, workspaceId, projectId, taskId)`.

---

## Scope & Effort Estimate

| Phase                    | Scope                                             | Risk                            |
| ------------------------ | ------------------------------------------------- | ------------------------------- |
| Phase 1: Interface       | New files only, no changes to existing code       | None                            |
| Phase 2: Kaneo adapter   | New files + thin wrapper, existing code untouched | Low                             |
| Phase 3: Rewire tools    | Modify all 28 tool files + `tools/index.ts`       | Medium — need behavioral parity |
| Phase 4: Rewire bot      | Modify `bot.ts`, `config.ts`, `errors.ts`         | Medium — core orchestration     |
| Phase 5: Cleanup         | Move files, update imports                        | Low — mechanical                |
| Phase 6: Second provider | New provider implementation                       | Low — validates the design      |

Phases 1-2 can be done without any risk of regression. Phases 3-4 are the critical refactor requiring careful testing. Phase 5 is cosmetic. Phase 6 is validation.
