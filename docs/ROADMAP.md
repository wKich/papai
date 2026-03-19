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

## Phase 7: Proactive Assistance — Briefings & Reminders

> Extends [design doc](docs/plans/2026-03-04-personal-assistant-expansion-design.md#phase-3-proactive-assistance).

**Goal:** papai initiates conversations — sending scheduled briefings, deadline alerts, and user-defined reminders — without waiting to be asked.

Key terms:

- **Briefing** — a scheduled digest bundling multiple signals into one message
- **Nudge** — an automatic reminder derived from task state or deadline policy
- **Reminder** — a message sent at a user-specified time

### 7a. Daily Briefing

- [ ] Morning briefing — cron-scheduled summary sent at a configurable time (`briefing_time` config key)
- [ ] Configurable sections — due today, overdue, in-progress, recently updated, newly assigned, suggested top-3 actions
- [ ] Missed briefing catch-up — on first message of the day if scheduled briefing was not received
- [ ] Briefing modes — short (summary only) and full (all sections)

New config keys: `briefing_time` (HH:MM or `off`), `timezone`, `briefing_mode` (`short` | `full`)

### 7b. Deadline Nudges & Overdue Alerts

- [ ] Pre-deadline nudge — message 1 day before due date
- [ ] Due-today alert — urgent message on due day if task still open
- [ ] Missed-deadline alert — follow-up 1 day after due date if not completed
- [ ] Escalation ladder — soft → urgent → daily escalation for persistently missed deadlines
- [ ] Staleness detection — alert for tasks with no status change in a configurable period
- [ ] Blocker detection — alert for tasks whose blockers are unresolved near deadline

New config keys: `deadline_nudge` (`on` | `off`), `stale_task_days`

### 7c. User-Scheduled Reminders

- [ ] One-time reminders — natural language scheduling ("remind me tomorrow at 9" / "in 3 hours")
- [ ] Task-linked reminders — tied to a specific task ("remind me about ABC one day before deadline")
- [ ] Repeating reminders — fixed-schedule recurrence ("every weekday at 9:00", "every Friday")
- [ ] Snooze and reschedule — snooze 15m / 1h / tomorrow morning; reschedule directly from reminder
- [ ] Dismiss with task action — mark task done directly from reminder message
- [ ] Duplicate suppression — avoid nudging the same issue repeatedly in a short window

New config keys: none (reminders keyed to user ID; quiet hours handled via notification preferences)

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

| Term                   | Definition                                                    |
| ---------------------- | ------------------------------------------------------------- |
| **Memo**               | Unstructured personal note captured by the user               |
| **Reminder**           | Message sent at a user-specified time                         |
| **Nudge**              | Automatic reminder derived from task state or deadline policy |
| **Repeating reminder** | A reminder that recurs on a schedule                          |
| **Recurring task**     | A task template that generates new work items each cycle      |
| **Suggestion**         | Context-triggered assistant recommendation                    |
| **Briefing**           | Scheduled digest bundling multiple signals into one message   |
| **Recall**             | Semantic search across memos by meaning                       |
