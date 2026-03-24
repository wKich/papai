# Deferred Prompts Design

## Overview

Refactor the existing proactive assistance system (reminders, briefings, alerts) into a unified
**deferred prompts** abstraction. Instead of three rigid code paths with hardcoded logic, all
scheduled and condition-based communications become LLM prompts executed with full tool access.

### Core Concepts

- **Scheduled prompt** — an LLM invocation that fires at a specific time (one-shot) or on a cron
  schedule (recurring). Subsumes reminders and briefings.
- **Alert prompt** — an LLM invocation triggered when a deterministic condition is met against
  task data. Subsumes hardcoded alert checks (deadlines, staleness, overdue).
- **Briefing** — no longer a special subsystem. Users explicitly opt in by creating a recurring
  scheduled prompt (e.g., "give me a daily summary of my tasks at 9am").

### Design Decisions

| Decision                   | Choice                        | Rationale                                                                                                       |
| -------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Tool access on execution   | Full tool set                 | Prompt text constrains behavior; no need for read-only mode                                                     |
| Alert condition evaluation | Deterministic filter schema   | LLM compiles natural language to filter at creation time; poller evaluates in code, no LLM calls during polling |
| Change detection           | Snapshot table                | Provider-agnostic; works uniformly across Kaneo/YouTrack                                                        |
| Alert poll interval        | Fixed 5 minutes               | Simple, predictable load                                                                                        |
| Scheduled poll interval    | Fixed 60 seconds              | Matches current reminder polling                                                                                |
| Recurring prompt limits    | None                          | Runs until manually cancelled                                                                                   |
| Result delivery            | Always send chat message      | Prompt text can instruct LLM to be brief or conditional                                                         |
| Conversation context       | Clean (no history)            | Each execution is isolated; avoids history pollution                                                            |
| Briefing opt-in            | Explicit                      | Users create it via natural language; no auto-creation                                                          |
| Tool design                | Unified tools                 | Single tool set routes to correct table based on input                                                          |
| Schedule vs condition      | Mutually exclusive            | Alerts already poll on fixed interval; no need to combine                                                       |
| Migration strategy         | Clean replacement             | Pre-production; old data model is fundamentally different                                                       |
| Data model                 | Two tables + shared interface | `scheduled_prompts` and `alert_prompts` with discriminated union in TypeScript                                  |

---

## Data Model

### Table: `scheduled_prompts`

| Column             | Type            | Description                                       |
| ------------------ | --------------- | ------------------------------------------------- |
| `id`               | TEXT (UUID)     | Primary key                                       |
| `user_id`          | TEXT            | Owner                                             |
| `prompt`           | TEXT            | Natural language instruction for the LLM          |
| `fire_at`          | TEXT (ISO 8601) | One-shot: when to fire. Recurring: next fire time |
| `cron_expression`  | TEXT            | Null for one-shot, 5-field cron for recurring     |
| `status`           | TEXT            | `active` \| `completed` \| `cancelled`            |
| `created_at`       | TEXT (ISO 8601) | Creation timestamp                                |
| `last_executed_at` | TEXT (ISO 8601) | Last execution timestamp, null if never           |

- One-shot: `fire_at` set, `cron_expression` null. Status becomes `completed` after execution.
- Recurring: both set. `fire_at` advances to next cron occurrence after each execution.

### Table: `alert_prompts`

| Column              | Type            | Description                                                    |
| ------------------- | --------------- | -------------------------------------------------------------- |
| `id`                | TEXT (UUID)     | Primary key                                                    |
| `user_id`           | TEXT            | Owner                                                          |
| `prompt`            | TEXT            | Natural language instruction for the LLM when condition is met |
| `condition`         | TEXT (JSON)     | Filter schema (see below)                                      |
| `status`            | TEXT            | `active` \| `cancelled`                                        |
| `created_at`        | TEXT (ISO 8601) | Creation timestamp                                             |
| `last_triggered_at` | TEXT (ISO 8601) | Last time condition was met and LLM was invoked                |
| `cooldown_minutes`  | INTEGER         | Minimum minutes between triggers. Default: 60                  |

### Table: `task_snapshots`

| Column        | Type            | Description                             |
| ------------- | --------------- | --------------------------------------- |
| `user_id`     | TEXT            | Snapshot owner                          |
| `task_id`     | TEXT            | Task ID from provider                   |
| `field`       | TEXT            | Field name (e.g., `status`, `priority`) |
| `value`       | TEXT            | Current known value                     |
| `captured_at` | TEXT (ISO 8601) | When this snapshot was taken            |

Composite primary key: `(user_id, task_id, field)`. Updated on each alert poll cycle. Used to
evaluate `changed_to` operators by comparing previous snapshot to current provider state.

---

## Alert Filter Schema

Stored in `alert_prompts.condition` as JSON. Validated with Zod v4 at creation time.

### Leaf condition

```json
{
  "field": "task.status",
  "op": "eq",
  "value": "done"
}
```

### Supported fields and operators

| Field           | Type     | Supported operators         |
| --------------- | -------- | --------------------------- |
| `task.status`   | string   | `eq`, `neq`, `changed_to`   |
| `task.priority` | string   | `eq`, `neq`, `changed_to`   |
| `task.assignee` | string   | `eq`, `neq`, `changed_to`   |
| `task.dueDate`  | date     | `eq`, `lt`, `gt`, `overdue` |
| `task.project`  | string   | `eq`, `neq`                 |
| `task.labels`   | string[] | `contains`, `not_contains`  |

### Special operators

- **`changed_to`** — true when the field's current value differs from the snapshot AND matches
  `value`. Snapshot is updated after evaluation.
- **`overdue`** — `task.dueDate < now()`. No `value` needed.

### Combinators

`and` and `or` arrays of conditions. Nest arbitrarily.

```json
{
  "and": [
    { "field": "task.project", "op": "eq", "value": "Project Alpha" },
    { "field": "task.status", "op": "changed_to", "value": "done" }
  ]
}
```

---

## LLM Tools

Five unified tools. Implementation routes to the correct table based on input.

### `create_deferred_prompt`

| Parameter          | Type   | Required                            | Description                           |
| ------------------ | ------ | ----------------------------------- | ------------------------------------- |
| `prompt`           | string | yes                                 | What the LLM should do when fired     |
| `schedule`         | object | mutually exclusive with `condition` | `{ fire_at?: string, cron?: string }` |
| `condition`        | object | mutually exclusive with `schedule`  | Filter schema                         |
| `cooldown_minutes` | number | no                                  | For alerts only. Default: 60          |

Validation rejects if both or neither of `schedule`/`condition` are provided.

### `list_deferred_prompts`

| Parameter | Type   | Required | Description                                            |
| --------- | ------ | -------- | ------------------------------------------------------ |
| `type`    | string | no       | `scheduled` \| `alert` \| omit for both                |
| `status`  | string | no       | `active` \| `completed` \| `cancelled` \| omit for all |

Returns merged list from both tables, each entry tagged with its type.

### `get_deferred_prompt`

| Parameter | Type   | Required | Description            |
| --------- | ------ | -------- | ---------------------- |
| `id`      | string | yes      | The deferred prompt ID |

### `update_deferred_prompt`

| Parameter          | Type   | Required | Description                       |
| ------------------ | ------ | -------- | --------------------------------- |
| `id`               | string | yes      | The deferred prompt ID            |
| `prompt`           | string | no       | Updated instruction text          |
| `schedule`         | object | no       | Updated schedule (scheduled only) |
| `condition`        | object | no       | Updated filter (alert only)       |
| `cooldown_minutes` | number | no       | Updated cooldown (alert only)     |

Cannot change type. Rejects cross-type field updates.

### `cancel_deferred_prompt`

| Parameter | Type   | Required | Description            |
| --------- | ------ | -------- | ---------------------- |
| `id`      | string | yes      | The deferred prompt ID |

Sets status to `cancelled` in whichever table contains the ID.

---

## Poller Architecture

Two independent polling loops, started at bot startup, stopped on shutdown.

### Scheduled prompt poller (every 60 seconds)

1. Query `scheduled_prompts` where `status = 'active'` and `fire_at <= now()`
2. For each due prompt:
   - Invoke LLM with: system prompt + prompt text, full tool set, clean context
   - Send LLM response to user via `chatProvider.sendMessage()`
   - Log execution to user's conversation history (see below)
   - One-shot (`cron_expression` is null): set `status = 'completed'`
   - Recurring: advance `fire_at` to next cron occurrence, update `last_executed_at`

### Alert poller (every 5 minutes)

1. Query `alert_prompts` where `status = 'active'` and (`last_triggered_at` is null OR
   `now() - last_triggered_at > cooldown_minutes`)
2. For each eligible alert:
   - Fetch current task data from provider for the user
   - Load existing snapshots from `task_snapshots`
   - Evaluate condition against current data + snapshots
   - If condition is met:
     - Invoke LLM with: alert system prompt + alert prompt text + matched task context,
       full tool set, clean context
     - Send LLM response to user via `chatProvider.sendMessage()`
     - Log execution to user's conversation history
     - Update `last_triggered_at`
   - Update `task_snapshots` with current field values (regardless of trigger)

### Alert system prompt template

```
You are a task management assistant executing an automated alert.
The following condition was met: [human-readable description of matched condition]
Matching tasks: [list of task IDs/titles that triggered the condition]

User instruction: [the prompt text from the alert]

Execute the user's instruction using the available tools. Report results concisely.
```

---

## History Logging

When a deferred prompt fires, the execution is logged to the user's conversation history:

1. **System message** (log entry):

   ```
   [Deferred Prompt] Type: scheduled | alert
   Prompt: "check completed tasks and provide summary"
   Triggered at: 2026-03-23T09:00:00Z
   ```

2. **Assistant message** — the LLM's response (same content sent via chat)

This enables the user to reference past executions in subsequent conversations
(e.g., "what did you do this morning?").

---

## Migration & Cleanup

### Remove

- `src/proactive/` — entire directory
- `src/db/migrations/011_proactive_alerts.ts` — old migration
- `tests/proactive/` — old tests
- Proactive scheduler wiring in `src/index.ts`
- Briefing catch-up hook in `src/llm-orchestrator.ts`
- Old proactive tool registration
- Config keys: `briefing_time`, `briefing_mode`, `deadline_nudges`, `staleness_days`

### Add

- `src/deferred-prompts/` — new directory:
  - `types.ts` — `DeferredPrompt` discriminated union, `AlertCondition` Zod schema,
    `ScheduledPrompt`, `AlertPrompt` types
  - `scheduled.ts` — CRUD for `scheduled_prompts` table
  - `alerts.ts` — CRUD for `alert_prompts` table, condition evaluation engine
  - `snapshots.ts` — task snapshot management
  - `poller.ts` — both polling loops
  - `tools.ts` — 5 unified LLM tools
  - `index.ts` — exports
- `src/db/migrations/012_deferred_prompts.ts` — new migration (create new tables, drop old)
- `tests/deferred-prompts/` — new tests

---

## Examples

### "Check completed tasks every week and provide summary report"

LLM creates a **scheduled prompt**:

- `prompt`: "Check all tasks with status 'done' across all projects. Provide a summary report of what was completed this week."
- `schedule`: `{ cron: "0 9 * * 1" }` (Monday 9am)

### "Tomorrow archive any stale tasks"

LLM creates a **one-shot scheduled prompt**:

- `prompt`: "Find all tasks that haven't been updated in 7+ days and archive them."
- `schedule`: `{ fire_at: "2026-03-24T09:00:00Z" }`

### "Send me brief info about projects when a task is done"

LLM creates an **alert prompt**:

- `prompt`: "A task was just completed. Provide a brief status update for the project it belongs to."
- `condition`: `{ "field": "task.status", "op": "changed_to", "value": "done" }`
- `cooldown_minutes`: 5
