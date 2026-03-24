# Roadmap

## Phase 1: Code Quality & Reliability

- [x] Structured logging — replace `console.error`/`console.log` with a leveled logger
- [x] [Granular error messages](docs/plans/2025-03-03-granular-error-messages.md) — surface specific failure reasons to the user instead of generic "something went wrong"
- [x] Workflow state resolution error handling — warn when a status name doesn't match any team workflow state
- [x] [Linear API response validation](docs/plans/2026-03-03-linear-api-response-validation.md) — add Zod schemas and handle missing/unexpected fields from API responses
- [x] ~~Configurable limits — history cap set to 100, max tool steps set to 25~~ (Not planned)

## Phase 2: Enhanced Tool Capabilities

- [x] Add comments to issues
- [x] Set due dates on issues
- [x] View issue details — full description and comments
- [x] Label management — list, create, and apply labels to issues
- [x] Issue relations — create and view blocks/duplicate/related relations
- [x] Create projects
- [x] [Remove labels from issues](docs/plans/2026-03-04-remove-labels-archive-issues.md)
- [x] [Delete / archive issues](docs/plans/2026-03-04-remove-labels-archive-issues.md)
- [x] ~~Assign issues to a cycle / iteration~~ (Not planned)

## Phase 3: Persistence & Context

- [x] [Database migration framework](docs/plans/2026-03-05-db-migrations.md) — lightweight versioned migration runner in `src/db/`, single shared `Database` instance, prerequisite for all schema changes
- [x] [Conversation history persistence](docs/plans/2026-03-05-conversation-history-persistence.md) — SQLite-backed two-tier memory: smart-trimmed working window (50-100 messages, memory-model-selected) + rolling summary + structured entity facts
- [x] Fix conversation prompt — persist assistant responses to enable multi-turn conversations
- [x] ~~User preference storage — default project, default priority~~ (Not planned)
- [x] ~~Session continuity across bot restarts~~ (Covered by conversation history persistence)

## Phase 4: Developer Experience

- [x] CI pipeline — format + lint + type-check on push and pull_request to master
- [x] [Unit tests for Linear wrapper functions](docs/plans/2025-03-03-unit-testing-coverage.md) — 95 tests across all linear modules and tool execute functions

## Phase 5: Advanced Features

- [x] [Multi-user support with per-user authorization](docs/plans/2026-03-05-multi-user-support.md)
- [x] Configurable LLM provider — swap GPT-4o for other models
- [x] ~~Rate limiting and request throttling~~ (Not planned)

## Phase 6: Personal Memory & Recall

> See [design doc](docs/plans/2026-03-04-personal-assistant-expansion-design.md) for full specification.

**Goal:** Let the user capture unstructured thoughts and retrieve them by keyword or meaning. The LLM decides whether a message is a task or a memo.

Key terms:

- **Memo** — an unstructured personal note saved by the user
- **Recall** — semantic search across past memos by meaning (not just keyword)
- **Memo-to-action** — converting a memo into a reminder or task

Features:

- [ ] Quick memo capture — save notes, decisions, links, ideas via natural language with optional tags
- [ ] Memo search — full-text search across memos by keyword or tag (`search_memos` tool)
- [ ] Semantic recall — vector-embedding search across memos by meaning (`recall` tool)
- [ ] Memo conversion — promote a memo into a reminder or task via natural language
- [ ] Memo management — list recent, pin, edit, archive, expire stale memos

New config keys: none (memos keyed to user ID)

## Phase 7: Deferred Prompts — Scheduled Tasks & Alerts

> See [design doc](docs/plans/2026-03-23-deferred-prompts-design.md) for full specification.

**Goal:** papai executes LLM-powered tasks on a schedule or when conditions are met — replacing rigid briefings, reminders, and alert checks with a unified deferred prompts abstraction.

Key terms:

- **Scheduled prompt** — an LLM invocation that fires at a specific time (one-shot) or on a cron schedule (recurring). Subsumes reminders and briefings.
- **Alert prompt** — an LLM invocation triggered when a deterministic condition is met against task data. The LLM compiles natural language to a filter schema at creation time; the poller evaluates conditions in code.

### 7a. Deferred Prompt Engine

- [x] Two-table data model — `scheduled_prompts` and `alert_prompts` with shared TypeScript discriminated union
- [x] Deterministic alert filter schema — field/operator/value conditions with `and`/`or` combinators, validated by Zod
- [x] Task snapshot table — `task_snapshots` for `changed_to` change detection across providers
- [x] Two polling loops — scheduled (60s) and alerts (5min), both with full LLM tool access
- [x] Five unified LLM tools — `create_deferred_prompt`, `list_deferred_prompts`, `get_deferred_prompt`, `update_deferred_prompt`, `cancel_deferred_prompt`
- [x] Per-project task fetching — alerts iterate `listProjects` + `listTasks` instead of surrogate search
- [x] Selective enrichment — only calls `getTask` when conditions reference fields not in `TaskListItem`
- [x] Execution history logging — deferred prompt results appended to conversation history

### 7b. Provider-Gated Condition Fields

- [ ] Add `updatedAt?: string` to `Task` type
- [ ] Populate `updatedAt` in YouTrack mapper (from `issue.updated` timestamp)
- [ ] Gate `task.updatedAt` field and `stale_days` operator on a new capability (e.g., `tasks.updatedAt`)
- [ ] Make condition schema provider-aware — validate available fields at alert creation time based on active provider capabilities
- [ ] Update LLM tool descriptions dynamically to reflect available condition fields

## Phase 8: Recurring Work Automation

**Goal:** Model work that repeats on a schedule or upon completion, generating new tasks automatically.

Key terms:

- **Repeating reminder** — a message that recurs on a schedule (no task created)
- **Recurring task** — a task template that generates a new work item on each cycle

These are distinct features: a repeating reminder sends a message; a recurring task creates or schedules work in the task provider.

### 8a. Recurring Task Templates

- [ ] Fixed-schedule recurrence — every Monday, first business day of month, etc.
- [ ] Completion-based recurrence — next occurrence created only after current one is done
- [ ] Template inheritance — next task carries over project, labels, assignee, priority from template
- [ ] Skip / pause — skip next occurrence or pause the series without deleting it
- [ ] Backfill control — ignore missed occurrences or create them retroactively

New config keys: none (recurrence rules stored per-template in DB)

### 8b. Repeating Reminders

> Covered by Phase 7c above (user-scheduled reminders already includes repeating mode).

## Phase 9: Event-Driven Suggestions

**Goal:** papai reacts to task lifecycle events and surfaces contextual suggestions without waiting to be asked.

Key terms:

- **Suggestion** — an assistant recommendation triggered by an event or state change
- **Event** — task creation, update, status change, completion, inactivity, deadline breach

Implementation modes:

- **Polling-based (MVP)** — periodic checks via `listTasks` / `searchTasks` against known state
- **Webhook-based (later)** — real-time event ingestion; see Backlog for prerequisite

### 9a. Task Lifecycle Suggestions

- [ ] On create — suggest due date, labels, assignee, related tasks, project, next action
- [ ] On update — suggest follow-up if due date moved, status regressed, or scope changed
- [ ] On complete — suggest creating a follow-up task, closing dependents, sending a summary
- [ ] On overdue — suggest rescheduling, reducing scope, escalating blockers
- [ ] On inactivity — "this task hasn't changed in N days, do you want to revisit it?"

### 9b. Weekly Review

- [ ] End-of-week wrap-up — automated Friday summary: completed, slipped, carried over
- [ ] Weekly planning session — Monday prompt for top-3 goals, surface overdue backlog
- [ ] Suggested top-3 actions — "What should I work on next?" at any time

New config keys: `weekly_review` (`on` | `off`), `workdays` (e.g. `mon-fri`)

## Phase 10: Notification Controls & User Preferences

**Goal:** Give users fine-grained control over when and how they receive assistant messages.

- [ ] Timezone setting — `timezone` config key (e.g. `Europe/Berlin`); all scheduled times in local time
- [ ] Quiet hours — suppress non-urgent messages outside working hours (`quiet_hours_start`, `quiet_hours_end`)
- [ ] Working days — configurable days for briefings and nudges (`workdays`)
- [ ] Delivery mode — `immediate`, `digest` (batch into a single daily message), or `muted`
- [ ] Per-feature toggles — enable/disable briefing, deadline nudges, recurring suggestions independently
- [ ] Snooze / dismiss / reschedule — interactive actions on any outbound assistant message

New config keys: `timezone`, `quiet_hours_start`, `quiet_hours_end`, `workdays`, `delivery_mode`, `briefing_time`, `deadline_nudge`, `weekly_review`, `stale_task_days`

## Phase 11: Planning Assistant & Calendar Integration

**Goal:** Context-aware, time-aware recommendations — "what should I work on right now?"

- [ ] Next best action — "I have 30 minutes, what should I do?" ranked by deadline, priority, energy
- [ ] Workload awareness — flag overloaded days; suggest moving lower-priority items
- [ ] Calendar integration — read-only event and free/busy awareness, first provider TBD (Google Calendar via OAuth, Apple Calendar via CalDAV)
- [ ] Calendar-aware briefing — include event count, schedule overview, and free time blocks in morning briefing
- [ ] Daily planning session — structured morning prompt: review agenda, pick top-3 tasks, surface blockers

New config keys: per-calendar-provider credentials in `user_config`

## Backlog

- [ ] Integration test scaffolding
- [ ] Webhook-based task provider notifications — prerequisite for real-time event-driven suggestions (Phase 9); useful when external systems mutate state (GitHub/CI auto-transitions, Sentry auto-created issues, UI edits)
- [ ] **Investigate pre-existing logic bug in `classify-error.ts`** — The `message.includes('issue')` matcher at line 19 is overly broad and could misclassify errors (e.g., "Configuration issue: timeout" → issue-not-found). Review error classification logic and tighten matchers.

---

## Terminology Reference

| Term                 | Definition                                                  |
| -------------------- | ----------------------------------------------------------- |
| **Memo**             | Unstructured personal note captured by the user             |
| **Scheduled prompt** | LLM invocation that fires at a time (one-shot or cron)      |
| **Alert prompt**     | LLM invocation triggered when a condition is met            |
| **Deferred prompt**  | Umbrella term for scheduled prompts and alert prompts       |
| **Recurring task**   | A task template that generates new work items each cycle    |
| **Suggestion**       | Context-triggered assistant recommendation                  |
| **Briefing**         | Scheduled digest bundling multiple signals into one message |
| **Recall**           | Semantic search across memos by meaning                     |
