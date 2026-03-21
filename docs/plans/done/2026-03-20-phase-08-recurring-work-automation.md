# Phase 08: Recurring Work Automation — Development Plan

**Created**: 2026-03-20  
**Scope**: User stories from `docs/user-stories/phase-08-recurring-work-automation.md`  
**Runtime**: Bun  
**Test runner**: `bun:test`  
**Linter**: oxlint (no `eslint-disable`, no `@ts-ignore`)

---

## Epic Overview

- **Business Value**: Teams and individuals stop losing track of routine work. Recurring tasks — weekly check-ins, monthly audits, per-completion cycles — are created automatically in the task tracker without requiring the user to remember them. A pause, skip, or stop command handles schedule exceptions cleanly, and a single list command gives a full audit of all standing commitments.
- **Success Metrics**:
  - A fixed-schedule template generates its next task at the correct time without manual intervention
  - A completion-triggered template creates its next occurrence immediately after the current task is marked done via the bot
  - Every generated task carries the same labels, priority, and assignee as the template definition
  - A paused series produces no further tasks until explicitly resumed; a skipped cycle is silently skipped and the series resumes normally
  - A user can choose to back-fill missed occurrences or ignore them at resume time
  - `list_recurring_tasks` returns all templates (active, paused, cancelled) with correct metadata
  - A stopped series never generates another task and is absent from the default list view
- **Priority**: Medium — extends standing utility; depends on stable Phase 3 (persistence) and Phase 2 (task tools)
- **Timeline**: 5–6 days

---

## Current State Audit

### What is already in place

| Area                                                                                     | Status      |
| ---------------------------------------------------------------------------------------- | ----------- |
| `create_task` tool with project, title, description, priority, labels, assignee, dueDate | ✅ Complete |
| `update_task` tool (used to detect completion transitions)                               | ✅ Complete |
| SQLite migration framework (`runMigrations`, numbered `NNN_name` convention)             | ✅ Complete |
| `drizzle-orm/bun-sqlite` schema + typed query layer                                      | ✅ Complete |
| Per-user `user_id` key on all data rows (isolation guarantee)                            | ✅ Complete |
| Tool index pattern: `makeXxxTool(provider)` returning `ToolSet[string]`                  | ✅ Complete |
| Structured logger with child scopes (`logger.child({ scope })`)                          | ✅ Complete |

### Confirmed gaps (mapped to user stories)

| Gap                                                                    | Story | File(s)                               |
| ---------------------------------------------------------------------- | ----- | ------------------------------------- |
| No `recurring_task_templates` table                                    | All   | `src/db/schema.ts` (new table needed) |
| No `recurring_task_occurrences` table                                  | 2, 4  | `src/db/schema.ts` (new table needed) |
| No cron / interval scheduling library                                  | 1, 4  | none yet                              |
| No `RecurringTaskService` for template CRUD                            | All   | none yet                              |
| No `RecurringTaskScheduler` for firing fixed-schedule jobs             | 1, 4  | none yet                              |
| No completion-hook logic after `update_task`                           | 2     | `src/tools/update-task.ts`            |
| No LLM tools: `create_recurring_task`, `list_recurring_tasks`, etc.    | All   | none yet                              |
| `src/db/index.ts` MIGRATIONS array stops at `007` (008 not registered) | N/A   | `src/db/index.ts`                     |

### User story status summary

| Story | Description                         | Status     | Work Required                                      |
| ----- | ----------------------------------- | ---------- | -------------------------------------------------- |
| US1   | Fixed-schedule recurring task       | ❌ Missing | Schema, service, scheduler, tool, tests            |
| US2   | Completion-based recurring task     | ❌ Missing | Schema, service, completion hook, tool, tests      |
| US3   | Template inheritance of metadata    | ❌ Missing | Service: occurrence creation reads template fields |
| US4   | Skip / pause a series               | ❌ Missing | Service fields, tools, scheduler integration       |
| US5   | Backfill control on resume          | ❌ Missing | Service: resumeTemplate with backfill option       |
| US6   | List all recurring task definitions | ❌ Missing | `list_recurring_tasks` tool + service query        |
| US7   | Stop a series permanently           | ❌ Missing | `stop_recurring_task` tool, status='cancelled'     |

---

## Library Research

### Cron / Schedule Parsing

Phase 8 introduces the first cron scheduling requirement in the codebase. Phase 7 (Proactive Assistance) will also need a scheduler; the library chosen here should serve both phases.

| Library          | Purpose                   | Bun support | Last update | Stars | License | Notes                                                     |
| ---------------- | ------------------------- | ----------- | ----------- | ----- | ------- | --------------------------------------------------------- |
| **croner**       | In-process cron scheduler | ✅ Yes      | 2025        | ~2.4k | MIT     | Zero dependencies, TypeScript-native, no Node APIs used   |
| `node-cron`      | In-process cron scheduler | ⚠️ Yes      | 2024        | ~3.5k | MIT     | More popular but ships with extra Node-specific overhead  |
| `cron`           | In-process cron scheduler | ⚠️ Limited  | 2024        | ~9k   | MIT     | Depends on `luxon`; heavier bundle                        |
| `toad-scheduler` | Interval-only scheduler   | ✅ Yes      | 2024        | ~500  | MIT     | No cron expression support; too limited for this use case |

**Recommendation**: `croner` — zero dependencies, TypeScript-first, uses the standard cron five-field format, verified Bun-compatible. Active development in 2025. Serves both Phase 8 (recurring tasks) and Phase 7 (briefings, nudges).

No date manipulation library is needed; SQLite `datetime()` and the `Date` built-in cover all required comparisons.

---

## Technical Architecture

### Component Map

```
User message: "create a weekly recurring task 'Team sync notes' every Monday"
  └─ processMessage (llm-orchestrator.ts)
       └─ callLlm → generateText (AI SDK)
            └─ create_recurring_task.execute
                 └─ RecurringTaskService.createTemplate(userId, params)
                      └─ INSERT recurring_task_templates
                      └─ RecurringTaskScheduler.register(template)
                           └─ Cron job: fires at next Monday
                                └─ RecurringTaskService.fireOccurrence(templateId)
                                     ├─ check status (skip next? paused? cancelled?)
                                     ├─ provider.createTask({ ...templateFields })
                                     └─ INSERT recurring_task_occurrences

task done via update_task tool
  └─ update_task.execute
       └─ completionHook(userId, taskId, newStatus, provider)
            └─ RecurringTaskService.findTemplateByOccurrence(taskId)
                 └─ status == 'on_completion' && templateStatus == 'active'?
                      └─ RecurringTaskService.fireOccurrence(templateId)
```

### Data Model

#### `recurring_task_templates`

| Column            | Type    | Description                                                             |
| ----------------- | ------- | ----------------------------------------------------------------------- |
| `id`              | TEXT PK | UUID                                                                    |
| `user_id`         | TEXT    | Owner (FK to users.platform_user_id conceptually; no hard FK in SQLite) |
| `title`           | TEXT    | Task title for generated occurrences                                    |
| `description`     | TEXT    | Optional task description                                               |
| `project_id`      | TEXT    | Target project ID in the task tracker                                   |
| `priority`        | TEXT    | Optional priority ('low'\|'medium'\|'high'\|'urgent'\|'no-priority')    |
| `assignee`        | TEXT    | Optional assignee username or ID                                        |
| `labels`          | TEXT    | JSON array of label IDs to apply (e.g. `["abc","def"]`)                 |
| `schedule_type`   | TEXT    | `'fixed'` (cron) or `'on_completion'`                                   |
| `cron_expression` | TEXT    | Standard 5-field cron string; NULL for `on_completion` templates        |
| `status`          | TEXT    | `'active'` \| `'paused'` \| `'cancelled'`; DEFAULT `'active'`           |
| `skip_next`       | INTEGER | Boolean (0/1); set to 1 to skip the next scheduled fire; DEFAULT 0      |
| `backfill_mode`   | TEXT    | `'ignore'` \| `'create'`; DEFAULT `'ignore'`                            |
| `last_fired_at`   | TEXT    | ISO timestamp of the last occurrence created; NULL if never fired       |
| `next_fire_at`    | TEXT    | ISO timestamp of the next scheduled fire; NULL for `on_completion`      |
| `created_at`      | TEXT    | DEFAULT `(datetime('now'))`                                             |

Indexes: `(user_id)`, `(status, next_fire_at)` — the second index accelerates the scheduler's "what's due?" startup query.

#### `recurring_task_occurrences`

| Column        | Type    | Description                                                  |
| ------------- | ------- | ------------------------------------------------------------ |
| `id`          | TEXT PK | UUID                                                         |
| `template_id` | TEXT    | FK to `recurring_task_templates.id`                          |
| `task_id`     | TEXT    | The external task ID created in the tracker (Kaneo/YouTrack) |
| `created_at`  | TEXT    | DEFAULT `(datetime('now'))`                                  |

Index: `(template_id)`, `(task_id)` — `task_id` lookup powers the completion hook.

### Scheduler Architecture

```
Bot startup (src/index.ts)
  └─ initDb()
  └─ RecurringTaskScheduler.start()       ← new
       └─ load all active fixed-schedule templates from DB
       └─ for each template:
            └─ Cron.schedule(expression, callback)

RecurringTaskScheduler.register(template)  ← called when create_recurring_task runs
  └─ Cron.schedule(expression, callback)

RecurringTaskScheduler.stop(templateId)    ← called on pause/cancel/stop
  └─ cron job for templateId is stopped

Bot shutdown (SIGINT / SIGTERM)
  └─ RecurringTaskScheduler.stopAll()     ← new
```

The scheduler is a singleton module (`src/recurring/scheduler.ts`) that holds a `Map<templateId, Cron>` and exposes `start()`, `register()`, `unregister()`, and `stopAll()`.

### Completion Hook

```typescript
// src/tools/update-task.ts — after provider.updateTask() succeeds
if (isDoneStatus(result.status)) {
  await completionHook(userId, result.id, provider, recurringService)
}
```

`isDoneStatus` checks whether the new status slug indicates completion. The exact mapping is provider-dependent; the hook delegates to the service which calls `provider.isCompletedStatus(statusSlug)` or uses a configurable list of "done" status names. For MVP: a completion hook fires when the new status equals `'done'` or `'completed'` (case-insensitive substring match). A follow-up can make this configurable.

### LLM Tools

| Tool name               | Description                                                        | Input schema (key fields)                                                                                                               |
| ----------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `create_recurring_task` | Create a new recurring task template                               | `title`, `projectId`, `scheduleType` ('fixed'\|'on_completion'), `cronExpression?`, `priority?`, `assignee?`, `labels?`, `description?` |
| `list_recurring_tasks`  | List all recurring task series for the user                        | `includeInactive?` (bool, default false)                                                                                                |
| `skip_next_occurrence`  | Skip the next scheduled occurrence of a series without stopping it | `templateId`                                                                                                                            |
| `pause_recurring_task`  | Pause or resume a recurring task series                            | `templateId`, `action` ('pause'\|'resume'), `backfillMode?` ('ignore'\|'create')                                                        |
| `stop_recurring_task`   | Permanently cancel a recurring task series                         | `templateId`                                                                                                                            |

`create_recurring_task` description instructs the LLM to translate natural language schedules ("every Monday", "first of the month") into standard 5-field cron expressions before calling the tool, with the field order `minute hour day-of-month month day-of-week`.

### File Structure

```
src/
  recurring/
    index.ts            ← public exports: RecurringTaskScheduler, RecurringTaskService, tools
    scheduler.ts        ← Cron job management (wraps croner)
    service.ts          ← Template + occurrence CRUD
    tools.ts            ← makeRecurringTaskTools(service): ToolSet
    types.ts            ← RecurringTemplate, RecurringOccurrence, ScheduleType, etc.
  db/
    migrations/
      009_recurring_tasks.ts   ← creates recurring_task_templates + recurring_task_occurrences
  tools/
    update-task.ts      ← completion hook added here (minimal change)
    index.ts            ← register recurring tools when provider is available

tests/
  recurring/
    service.test.ts     ← unit tests for RecurringTaskService
    scheduler.test.ts   ← unit tests for RecurringTaskScheduler (mock Cron)
    tools.test.ts       ← unit tests for each LLM tool wrapper
```

---

## Detailed Task Breakdown

### Phase 1 — DB Schema & Migration (0.5 days)

#### Task 1.1 — Register migration 008 in `src/db/index.ts`

- **File**: `src/db/index.ts`
- **Change**: Add `migration008GroupMembers` import and include it in the `MIGRATIONS` array before adding migration 009. This is a prerequisite to maintain correct migration ordering.
- **Estimate**: 0.25h ±0 | **Priority**: Blocker
- **Acceptance Criteria**: `initDb()` applies all migrations including 008 without error
- **Dependencies**: None

#### Task 1.2 — Create `src/db/migrations/009_recurring_tasks.ts`

- **File**: `src/db/migrations/009_recurring_tasks.ts` (new)
- **Change**: `CREATE TABLE recurring_task_templates (...)` and `CREATE TABLE recurring_task_occurrences (...)` with all indexes defined in the data model section above.
- **Estimate**: 0.5h ±0.25h | **Priority**: High
- **Acceptance Criteria**:
  - Migration runs cleanly on an empty DB and on a DB with migrations 001–008 already applied
  - Both tables and all indexes are present after `initDb()`
- **Dependencies**: Task 1.1

#### Task 1.3 — Add Drizzle schema definitions to `src/db/schema.ts`

- **File**: `src/db/schema.ts`
- **Change**: Add `recurringTaskTemplates` and `recurringTaskOccurrences` table definitions using `sqliteTable` with the full column and index spec from the data model section. Export inferred types (`RecurringTaskTemplate`, `RecurringTaskOccurrence`).
- **Estimate**: 0.5h ±0.25h | **Priority**: High
- **Acceptance Criteria**:
  - `typeof recurringTaskTemplates.$inferSelect` matches the data model column set
  - `bun typecheck` passes with no new errors
- **Dependencies**: Task 1.2

---

### Phase 2 — Recurring Task Service (1 day)

#### Task 2.1 — Create `src/recurring/types.ts`

- **File**: `src/recurring/types.ts` (new)
- **Change**: Define `ScheduleType = 'fixed' | 'on_completion'`, `TemplateStatus = 'active' | 'paused' | 'cancelled'`, `BackfillMode = 'ignore' | 'create'`, and `CreateTemplateParams` (the input shape for `createTemplate`).
- **Estimate**: 0.25h ±0 | **Priority**: High
- **Dependencies**: None

#### Task 2.2 — Create `src/recurring/service.ts`

- **File**: `src/recurring/service.ts` (new)
- **Exports**: `RecurringTaskService` class with the following methods:

  | Method                                     | Description                                                                                                              |
  | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
  | `createTemplate(userId, params)`           | INSERT into recurring_task_templates; compute + store `next_fire_at` for fixed templates                                 |
  | `listTemplates(userId, includeInactive)`   | SELECT templates; if `!includeInactive`, filter out 'cancelled'                                                          |
  | `getTemplate(templateId)`                  | SELECT single template by ID                                                                                             |
  | `skipNext(templateId)`                     | UPDATE `skip_next = 1`                                                                                                   |
  | `pauseTemplate(templateId)`                | UPDATE `status = 'paused'`                                                                                               |
  | `resumeTemplate(templateId, backfillMode)` | UPDATE `status = 'active'`, apply backfill logic                                                                         |
  | `cancelTemplate(templateId)`               | UPDATE `status = 'cancelled'`                                                                                            |
  | `fireOccurrence(templateId, provider)`     | Core method: check skip/status, call `provider.createTask`, INSERT occurrence, update `last_fired_at` and `next_fire_at` |
  | `findTemplateByTaskId(taskId)`             | SELECT from occurrences JOIN templates WHERE task_id = ?                                                                 |

  **`resumeTemplate` backfill logic**:
  - Compute all schedule dates between `last_fired_at` (or `created_at`) and now using the cron expression
  - If `backfillMode === 'create'`: create one task per missed cycle with the original next-fire timestamp as due date; INSERT each into occurrences
  - If `backfillMode === 'ignore'`: advance `next_fire_at` to the next future date, no tasks created for missed slots

  **`fireOccurrence` skip-next logic**:
  - If `skip_next === 1`: SET `skip_next = 0`, advance `next_fire_at`, return `{ action: 'skipped' }` without creating a task
  - Otherwise: create the task and record occurrence

- **Estimate**: 3h ±1h | **Priority**: High
- **Acceptance Criteria**:
  - `createTemplate` with a fixed schedule stores a non-null `next_fire_at`
  - `createTemplate` with `on_completion` stores NULL `next_fire_at`
  - `fireOccurrence` on a paused template returns `{ action: 'skipped' }` without creating a task
  - `fireOccurrence` on a template with `skip_next = 1` sets `skip_next = 0` and does not create a task
  - `resumeTemplate(..., 'create')` with 3 missed slots creates 3 tasks and 3 occurrence rows
  - `resumeTemplate(..., 'ignore')` with 3 missed slots creates 0 tasks and 0 occurrence rows
- **Dependencies**: Tasks 1.3, 2.1

---

### Phase 3 — Scheduler (1 day)

#### Task 3.1 — Add `croner` dependency

- **File**: `package.json`
- **Change**: Add `"croner": "^9.0.0"` to `dependencies` (latest stable as of 2025).
- **Estimate**: 0.1h ±0 | **Priority**: High
- **Dependencies**: None

#### Task 3.2 — Create `src/recurring/scheduler.ts`

- **File**: `src/recurring/scheduler.ts` (new)
- **Exports**: `RecurringTaskScheduler` class.

  | Method                                  | Description                                                                                                     |
  | --------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
  | `start(service, provider)`              | Load all active fixed-schedule templates from DB via `service.listTemplates`; call `register()` for each        |
  | `register(template, service, provider)` | Create a `Cron` job with `noLogs: true` that calls `service.fireOccurrence(template.id, provider)` on each fire |
  | `unregister(templateId)`                | Stop and delete the Cron job for this template ID                                                               |
  | `stopAll()`                             | Iterate `Map<templateId, Cron>` and stop each                                                                   |

  Implementation notes:
  - Uses `new Cron(expression, { timezone: 'UTC' }, callback)` from `croner`
  - `Map<string, Cron>` keyed by `templateId`
  - `start()` is idempotent: only registers templates not already registered
  - Errors thrown by `fireOccurrence` are caught, logged, and do not crash the scheduler

- **Estimate**: 2h ±0.5h | **Priority**: High
- **Acceptance Criteria**:
  - `start()` on a DB with 3 active fixed-schedule templates registers 3 Cron jobs
  - `unregister(id)` stops the specific job without affecting others
  - `stopAll()` leaves 0 active jobs
  - An error in `fireOccurrence` is logged but does not propagate to the Cron runtime
- **Dependencies**: Tasks 2.2, 3.1

#### Task 3.3 — Wire scheduler into `src/index.ts`

- **File**: `src/index.ts`
- **Change**: After `initDb()`, call `await RecurringTaskScheduler.start(service, provider)`. In `SIGINT`/`SIGTERM` handlers, call `RecurringTaskScheduler.stopAll()`.
- **Estimate**: 0.25h ±0 | **Priority**: High
- **Acceptance Criteria**: Bot startup log includes a message: "Recurring task scheduler started: N templates registered"
- **Dependencies**: Tasks 3.2, tool registration (Phase 4)

---

### Phase 4 — LLM Tools (1 day)

#### Task 4.1 — Create `src/recurring/tools.ts`

- **File**: `src/recurring/tools.ts` (new)
- **Exports**: `makeRecurringTaskTools(service, scheduler): ToolSet` returning all 5 tools.

  **`create_recurring_task`**:
  - Input schema: `title`, `projectId`, `scheduleType` ('fixed' | 'on_completion'), `cronExpression` (required when scheduleType='fixed'), `description?`, `priority?`, `assignee?`, `labels?` (string[])
  - Description (key excerpt): "Create a recurring task template. For fixed schedules, translate natural language like 'every Monday at 9am' into a 5-field cron expression (e.g. '0 9 \* \* 1') before calling this tool. Fields: minute hour day-of-month month day-of-week."
  - Execute: call `service.createTemplate(userId, params)`, then `scheduler.register(template, ...)`; reply with template ID and human-readable next-fire date

  **`list_recurring_tasks`**:
  - Input schema: `includeInactive?` boolean (default false)
  - Execute: call `service.listTemplates(userId, includeInactive)`; format each as: name, project, schedule or trigger, status, next occurrence

  **`skip_next_occurrence`**:
  - Input schema: `templateId` string
  - Execute: `service.getTemplate(templateId)` (validate ownership: `template.userId === userId`), then `service.skipNext(templateId)`

  **`pause_recurring_task`**:
  - Input schema: `templateId`, `action` ('pause'|'resume'), `backfillMode?` ('ignore'|'create', only relevant for 'resume')
  - Execute: dispatch to `service.pauseTemplate` or `service.resumeTemplate`; on resume call `scheduler.register(template, ...)`; on pause call `scheduler.unregister(templateId)`

  **`stop_recurring_task`**:
  - Input schema: `templateId`
  - Execute: `service.cancelTemplate(templateId)`, then `scheduler.unregister(templateId)`

  All tools validate that the template belongs to the calling user (`template.userId === userId`) before mutating, returning a `providerError.notFound('recurring_template', templateId)` if the lookup fails or the user doesn't own it.

- **Estimate**: 2h ±0.5h | **Priority**: High
- **Acceptance Criteria**:
  - All 5 tools pass their `execute` path in unit tests with a mock service
  - Each tool returns a user-facing confirmation string on success
  - Ownership check throws the correct `AppError` for a mismatched user
- **Dependencies**: Tasks 2.2, 3.2

#### Task 4.2 — Register recurring tools in `src/tools/index.ts`

- **File**: `src/tools/index.ts`
- **Change**: Import `makeRecurringTaskTools` and include the returned tools in the tool set passed to the LLM. These tools are always registered (no capability gate needed — they operate on local DB, not the remote provider).
- **Estimate**: 0.25h ±0 | **Priority**: High
- **Acceptance Criteria**: `Object.keys(makeAllTools(provider, service, scheduler))` includes all 5 recurring tool names
- **Dependencies**: Task 4.1

---

### Phase 5 — Completion Hook (0.5 days)

#### Task 5.1 — Add completion hook to `src/tools/update-task.ts`

- **File**: `src/tools/update-task.ts`
- **Change**: After a successful `provider.updateTask(...)`, if the new `result.status` matches a set of completion indicators, call `recurringService.findTemplateByTaskId(result.id)` and, if a matching `on_completion` template is found, call `recurringService.fireOccurrence(templateId, provider)`.

  Completion indicator: `result.status` lowercased matches any of `['done', 'completed', 'closed', 'resolved']`. This list is a constant in `src/recurring/service.ts` exported as `COMPLETION_STATUSES`.

  The tool's `make` function signature is extended: `makeUpdateTaskTool(provider, recurringService?)`. The second argument is optional so existing tests do not break. When omitted, the hook is a no-op.

- **Estimate**: 1h ±0.5h | **Priority**: High
- **Acceptance Criteria**:
  - When `update_task` sets status to 'done' and the task has a matching `on_completion` template, a new task is created in the tracker and an occurrence row is inserted
  - When no matching template exists, behavior is unchanged
  - When `recurringService` is not provided (existing callers), no error is thrown
- **Dependencies**: Task 2.2

---

### Phase 6 — Tests (1 day)

#### Task 6.1 — Create `tests/recurring/service.test.ts`

- **File**: `tests/recurring/service.test.ts` (new)
- **Setup**: In-memory DB with migrations 001–009, `drizzle-orm/bun-sqlite`, mock `TaskProvider`.
- **Test cases**:

  **`createTemplate` — fixed schedule**
  1. `stores template with computed next_fire_at` — create fixed template; assert `next_fire_at` is a future ISO string
  2. `stores template with NULL next_fire_at for on_completion` — create completion template; assert `next_fire_at` is null

  **`listTemplates`** 3. `returns only active templates by default` — create active + cancelled templates; assert only active is returned when `includeInactive = false` 4. `returns all templates when includeInactive = true`

  **`fireOccurrence`** 5. `creates task and records occurrence on active template` — mock provider returns `{ id: 'task-1', ... }`; assert occurrence row inserted with `task_id = 'task-1'` 6. `skips and clears skip_next flag when skip_next = 1` — set skip_next; fire; assert no task created, `skip_next = 0` 7. `does nothing on paused template` — pause template; fire; assert no task created 8. `advances next_fire_at after successful fire` — fire twice; assert `next_fire_at` increments by expected interval

  **`skipNext`** 9. `sets skip_next to 1`

  **`pauseTemplate` / `resumeTemplate`** 10. `pause sets status to paused` 11. `resume sets status to active` 12. `resume with backfill=create creates tasks for each missed slot` 13. `resume with backfill=ignore creates no tasks, advances next_fire_at`

  **`cancelTemplate`** 14. `sets status to cancelled`

  **`findTemplateByTaskId`** 15. `returns template when task_id matches an occurrence` 16. `returns null when task_id has no occurrence`

- **Estimate**: 2h ±0.5h | **Priority**: High
- **Dependencies**: Tasks 2.2, 1.2, 1.3

#### Task 6.2 — Create `tests/recurring/scheduler.test.ts`

- **File**: `tests/recurring/scheduler.test.ts` (new)
- **Setup**: Mock `croner` (stub `Cron` class with `stop()` spy). Mock `RecurringTaskService`.
- **Test cases**:
  1. `start() registers a cron job for each active fixed-schedule template`
  2. `start() skips on_completion templates`
  3. `register() adds a new job for a single template`
  4. `unregister() stops the cron job for the given template`
  5. `stopAll() stops all registered jobs and empties the map`
  6. `fireOccurrence errors are caught and logged, not rethrown`

- **Estimate**: 1h ±0.5h | **Priority**: High
- **Dependencies**: Tasks 3.2, 6.1

#### Task 6.3 — Create `tests/recurring/tools.test.ts`

- **File**: `tests/recurring/tools.test.ts` (new)
- **Setup**: Mock `RecurringTaskService` and `RecurringTaskScheduler`. Test each tool's `execute` function in isolation.
- **Test cases** (grouped by tool):

  **`create_recurring_task`**
  1. `calls service.createTemplate and scheduler.register, returns confirmation`
  2. `returns error on invalid cron expression (cronExpression fails validation)`

  **`list_recurring_tasks`** 3. `returns formatted list of templates` 4. `returns "no recurring tasks" message when list is empty`

  **`skip_next_occurrence`** 5. `calls service.skipNext for owned template` 6. `returns not-found error for unknown templateId` 7. `returns error when template belongs to a different user`

  **`pause_recurring_task`** 8. `calls service.pauseTemplate and scheduler.unregister on action=pause` 9. `calls service.resumeTemplate and scheduler.register on action=resume` 10. `passes backfillMode to resumeTemplate`

  **`stop_recurring_task`** 11. `calls service.cancelTemplate and scheduler.unregister` 12. `returns confirmation with template name`

- **Estimate**: 1.5h ±0.5h | **Priority**: High
- **Dependencies**: Task 4.1

#### Task 6.4 — Extend `tests/tools/task-tools.test.ts` for completion hook

- **File**: `tests/tools/task-tools.test.ts`
- **Change**: Add test cases for the updated `makeUpdateTaskTool`:
  1. `completion hook fires when status transitions to done and template exists`
  2. `completion hook is skipped when no matching template exists`
  3. `no error when recurringService is not provided (backward compat)`
- **Estimate**: 0.5h ±0.25h | **Priority**: High
- **Dependencies**: Task 5.1

---

### Phase 7 — Integration & Wiring (0.5 days)

#### Task 7.1 — Thread `RecurringTaskService` through `src/tools/index.ts`

- **File**: `src/tools/index.ts`
- **Change**: `makeAllTools(provider, recurringService?, scheduler?)` — pass optional service and scheduler down to `makeUpdateTaskTool` (for the completion hook) and `makeRecurringTaskTools`.
- **Estimate**: 0.25h ±0 | **Priority**: High
- **Dependencies**: Tasks 4.2, 5.1

#### Task 7.2 — Instantiate service and scheduler in `src/index.ts`

- **File**: `src/index.ts`
- **Change**:
  1. Import and instantiate `RecurringTaskService` after `initDb()`
  2. Import and instantiate `RecurringTaskScheduler`
  3. Call `scheduler.start(service, provider)` after the task provider is ready
  4. Pass `service` and `scheduler` into `makeAllTools(provider, service, scheduler)`
  5. Call `scheduler.stopAll()` in SIGINT and SIGTERM handlers
- **Estimate**: 0.5h ±0.25h | **Priority**: High
- **Dependencies**: Tasks 3.3, 7.1

#### Task 7.3 — Update MIGRATIONS array in `src/db/index.ts`

- **File**: `src/db/index.ts`
- **Change**: Add `migration008GroupMembers` and `migration009RecurringTasks` imports; append both to the `MIGRATIONS` array in order.
- **Estimate**: 0.1h ±0 | **Priority**: Blocker
- **Dependencies**: Tasks 1.1, 1.2

---

## Risk Assessment Matrix

| Risk                                                                                             | Probability | Impact | Mitigation                                                                                                                         | Owner |
| ------------------------------------------------------------------------------------------------ | ----------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Cron fires while bot is restarting (race on startup load)                                        | Low         | Medium | `scheduler.start()` is called after `initDb()` and after the provider is ready; no jobs fire before the scheduler is fully wired   | Dev   |
| LLM produces invalid cron expressions ("every 2nd Tuesday")                                      | Medium      | Low    | Validate cron string with `croner`'s `Cron.validate(expr)` in the tool's execute before saving; return an actionable error message | Dev   |
| Completion-status detection is too broad or too narrow (e.g. 'done' vs provider's actual string) | Medium      | Medium | Expose `COMPLETION_STATUSES` as a constant; document as configurable in a follow-up; LLM can tell user what slug triggers it       | Dev   |
| `fireOccurrence` double-fires if bot restarts mid-cron-window                                    | Low         | Medium | Record `last_fired_at` before creating the task; scheduler skips if `last_fired_at` >= current window start                        | Dev   |
| Backfill creates a large number of tasks unexpectedly (long pause on a high-frequency template)  | Low         | High   | Cap backfill at 10 occurrences per resume; warn user if cap is hit and prompt for explicit confirmation                            | Dev   |
| `croner` version incompatibility with Bun                                                        | Low         | High   | Pin to `croner@9.x`; verify with `bun test tests/recurring/scheduler.test.ts` before merging                                       | Dev   |
| `on_completion` hook adds latency to every `update_task` call                                    | Low         | Low    | DB lookup is a single indexed row; async `fireOccurrence` is awaited only when a matching template is found (rare path)            | Dev   |

---

## Resource Requirements

- **Development Hours**: 28h ±4h total (5–6 working days)
- **New Production Dependency**: `croner@^9` (zero runtime deps, ~12 kB)
- **New Dev Dependencies**: None
- **Database Changes**: 2 new tables, 4 new indexes, 1 migration file
- **New Source Files**: 5 (`src/recurring/index.ts`, `scheduler.ts`, `service.ts`, `tools.ts`, `types.ts`, `src/db/migrations/009_recurring_tasks.ts`)
- **Modified Source Files**: `src/db/schema.ts`, `src/db/index.ts`, `src/tools/update-task.ts`, `src/tools/index.ts`, `src/index.ts`
- **New Test Files**: 3 (`tests/recurring/service.test.ts`, `scheduler.test.ts`, `tools.test.ts`)
- **Modified Test Files**: `tests/tools/task-tools.test.ts`
- **Skills Required**: SQLite schema design, cron expression format, Drizzle ORM, `bun:test` mock patterns

---

## Planning Quality Gates

**✅ Requirements Coverage**

- [x] US1 (fixed schedule) → Tasks 1.x, 2.x, 3.x, 4.1, 6.1, 6.2
- [x] US2 (on_completion) → `schedule_type='on_completion'`, Tasks 2.2, 5.1, 6.4
- [x] US3 (metadata inheritance) → `fireOccurrence` reads template fields; covered in 6.1 task 5
- [x] US4 (skip/pause) → Tasks 2.2 (`skipNext`, `pauseTemplate`), 4.1, 3.2
- [x] US5 (backfill) → Tasks 2.2 (`resumeTemplate`), 4.1, 6.1 tasks 12–13
- [x] US6 (list) → `list_recurring_tasks` tool, Task 4.1, 6.3
- [x] US7 (stop) → `stop_recurring_task` tool, `cancelTemplate`, Task 4.1, 6.3

**✅ Library Research Validation**

- [x] `croner` v9 verified Bun-compatible, zero deps, MIT, actively maintained (2025)
- [x] No custom cron engine; no date-math library needed
- [x] License: MIT — compatible with project

**✅ Risk Management**

- [x] Backfill cap prevents surprise task floods
- [x] Cron validation at tool input prevents bad data reaching the DB
- [x] Double-fire guard via `last_fired_at` check

**✅ Tracking Framework**

- [x] 7 phases with clear file-level deliverables
- [x] Every task has measurable acceptance criteria
- [x] Test counts: 16 service tests + 6 scheduler tests + 12 tool tests + 3 update-task tests = 37 new tests minimum
