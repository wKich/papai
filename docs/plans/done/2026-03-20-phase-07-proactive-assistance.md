# Phase 07: Proactive Assistance — Development Plan

**Created**: 2026-03-20  
**Scope**: User stories from `docs/user-stories/phase-07-proactive-assistance.md`  
**Runtime**: Bun  
**Test runner**: `bun:test`  
**Linter**: oxlint (no `eslint-disable`, no `@ts-ignore`)

---

## Epic Overview

- **Business Value**: The bot transforms from a purely reactive assistant into a proactive teammate. Users receive time-sensitive information — morning briefings, deadline nudges, overdue escalations, staleness alerts, and personal reminders — without having to ask. Time-critical work no longer falls through the cracks because the user didn't check in at the right moment.
- **Success Metrics**:
  - A configured morning briefing is delivered at the user's chosen time in their local timezone on all working days
  - A short briefing contains only summary counts; a full briefing contains all six sections
  - A missed briefing is prepended to the user's first message of the day
  - A deadline nudge fires the day before a task is due; a due-day alert fires on the due date; overdue escalations fire each subsequent day, increasing in tone up to a daily urgent notice
  - A task reaching the staleness threshold generates a single alert identifying the task by name, current status, and inactive day count
  - A task with an unresolved blocker, due in ≤1 day, generates a blocked-deadline alert naming both tasks
  - A one-time reminder is delivered at the time the user specified; a recurring reminder fires on every scheduled occurrence until cancelled
  - Snooze, reschedule, and task completion are all actionable from a reminder reply without context switching
  - No duplicate alert is sent for the same task/alert-type pair within its suppression window
- **Priority**: High — directly addresses the bot's core limitation of being unreachable until the user speaks first; depends on stable Phase 3 (persistence), Phase 2 (task tools), and Phase 8 (installs `croner`)
- **Timeline**: 7–8 days

---

## Current State Audit

### What is already in place

| Area                                                                    | Status                            |
| ----------------------------------------------------------------------- | --------------------------------- |
| `create_task`, `update_task`, `list_tasks`, `search_tasks`, `get_task`  | ✅ Complete                       |
| `user_config` table with `getCachedConfig` / `setCachedConfig`          | ✅ Complete                       |
| SQLite migration framework (`runMigrations`, numbered `NNN_name`)       | ✅ Complete                       |
| `drizzle-orm/bun-sqlite` schema + typed query layer                     | ✅ Complete                       |
| Per-user `user_id` key on all data rows (isolation guarantee)           | ✅ Complete                       |
| `chatProvider.sendMessage(userId, markdown)` for initiating contact     | ✅ Complete                       |
| Structured logger with child scopes (`logger.child({ scope })`)         | ✅ Complete                       |
| Tool index pattern: `makeXxxTool(provider)` returning `ToolSet[string]` | ✅ Complete                       |
| `processMessage()` — entry point for all user messages                  | ✅ Complete                       |
| `croner` scheduler library                                              | ⚠️ Added by Phase 8 (reused here) |
| Migration 008 `group_members` registered in `src/db/index.ts`           | ⚠️ Registered by Phase 8          |
| Migration 009 `recurring_task_templates/occurrences`                    | ⚠️ Added by Phase 8               |

### Confirmed gaps (mapped to user stories)

| Gap                                                                        | Story               | File(s)                               |
| -------------------------------------------------------------------------- | ------------------- | ------------------------------------- |
| No `reminders` table                                                       | US8, US9, US10      | `src/db/schema.ts` (new table needed) |
| No `user_briefing_state` table                                             | US1, US2, US3       | `src/db/schema.ts` (new table needed) |
| No `alert_state` table (per-task staleness tracking + suppression)         | US5, US6, US7, US10 | `src/db/schema.ts` (new table needed) |
| No new config keys for briefing / alert settings                           | US1, US2, US4, US6  | `src/types/config.ts`                 |
| No `ReminderService` for reminder CRUD and scheduling                      | US8, US9, US10      | none yet                              |
| No `BriefingService` for generating briefing content                       | US1, US2, US3       | none yet                              |
| No `ProactiveAlertService` for deadline/staleness/blocked checks           | US4–US7             | none yet                              |
| No `ProactiveAlertScheduler` for all timed jobs                            | US1–US9             | none yet                              |
| No proactive LLM tools (`set_reminder`, `list_reminders`, etc.)            | US8, US9, US10      | none yet                              |
| No first-message catch-up hook in `processMessage`                         | US3                 | `src/llm-orchestrator.ts`             |
| `src/db/index.ts` MIGRATIONS array stops at 007 (008–009 added by Phase 8) | N/A                 | `src/db/index.ts`                     |

### User story status summary

| Story | Description                               | Status     | Work Required                                         |
| ----- | ----------------------------------------- | ---------- | ----------------------------------------------------- |
| US1   | Morning briefing at a chosen time         | ❌ Missing | Schema, config, BriefingService, scheduler, tests     |
| US2   | Short vs full briefing mode               | ❌ Missing | Config key, BriefingService sections, tests           |
| US3   | Missed briefing catch-up on first message | ❌ Missing | BriefingService, catch-up hook in processMessage      |
| US4   | Pre-deadline nudge (day before)           | ❌ Missing | ProactiveAlertService, scheduler, suppression, tests  |
| US5   | Due-day and overdue escalation alerts     | ❌ Missing | ProactiveAlertService, escalation logic, tests        |
| US6   | Staleness alert for inactive tasks        | ❌ Missing | alert_state table, ProactiveAlertService, tests       |
| US7   | Blocked task alert near deadline          | ❌ Missing | ProactiveAlertService (relation check), tests         |
| US8   | One-time reminders in natural language    | ❌ Missing | ReminderService, scheduler poller, tool, tests        |
| US9   | Repeating reminders on a fixed schedule   | ❌ Missing | ReminderService (cron field), scheduler, tool, tests  |
| US10  | Snooze, reschedule, and act from reminder | ❌ Missing | ReminderService, snooze/reschedule tools, dedup logic |

---

## Library Research

### Scheduler — `croner` (reused from Phase 8)

Phase 8 selected and installed `croner@^9` as the in-process cron scheduler for recurring task automation. Phase 7 reuses the same library. No additional scheduler dependency is needed.

| Library     | Decision           | Rationale                                                                                                          |
| ----------- | ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| **croner**  | ✅ Reuse (Phase 8) | Zero dependencies, TypeScript-native, timezone-aware via `{ timezone }` option, Bun-compatible, MIT, 2025 activity |
| `node-cron` | ❌ Skip            | No built-in timezone support without `moment-timezone`; more Node-specific overhead                                |
| `cron`      | ❌ Skip            | Requires `luxon`; heavier bundle; not needed when croner is already installed                                      |

**Implementation note**: If Phase 7 is implemented before Phase 8, add `"croner": "^9.0.0"` to `package.json` as part of this phase (mirrors Phase 8 Task 3.1). If Phase 8 is already implemented, this step is a no-op.

### Timezone Handling

Croner's `Cron` constructor accepts `{ timezone: "America/New_York" }` (IANA format), making per-user briefing time scheduling straightforward. No additional date library needed; all comparisons use the JS `Date` built-in and SQLite `date('now')`.

### Natural Language Time Parsing (US8)

The user enters reminders like "remind me tomorrow at 9am" or "in 3 hours". The LLM (already integrated) resolves these expressions and calls `set_reminder` with an explicit ISO timestamp. No date-parsing library is needed in the bot itself — the LLM performs all NL-to-datetime interpretation before the tool is invoked.

| Approach                        | Decision  | Rationale                                                                            |
| ------------------------------- | --------- | ------------------------------------------------------------------------------------ |
| LLM resolves NL → ISO timestamp | ✅ Chosen | Zero extra dependency; LLM already handles NL; consistent with existing tool pattern |
| `chrono-node` (NL date parser)  | ❌ Skip   | Extra dependency; redundant when LLM is available in the call chain                  |
| `date-fns` / `dayjs`            | ❌ Skip   | Not needed; `Date` built-in suffices for all date arithmetic here                    |

---

## Technical Architecture

### Component Map

```
Scheduler tick (croner)                                User message
  │                                                          │
  ├─ BriefingJob (per-user cron)                             ▼
  │    └─ BriefingService.generate(userId, mode)      processMessage()
  │         └─ provider.listTasks / searchTasks            │
  │         └─ build sections + format markdown             ├─ BriefingService.getMissedBriefing(userId)
  │    └─ chatProvider.sendMessage(userId, briefing)        │    └─ prepend catch-up if missed  │                                                          │
  ├─ AlertPollerJob (global daily cron)                      ▼
  │    └─ ProactiveAlertService.runAlertCycle()        callLlm()
  │         └─ for each user with deadline_nudges:          │
  │              provider.listTasks (all projects)           └─ LLM calls tools:
  │              filter: due-tomorrow, due-today, overdue         set_reminder
  │              filter: stale (via alert_state table)            list_reminders
  │              filter: blocked + due ≤1 day                     cancel_reminder
  │              suppress duplicates via alert_state              snooze_reminder
  │              chatProvider.sendMessage(userId, alert)          get_briefing
  │
  └─ ReminderPollerJob (every-minute cron)
       └─ ReminderService.fetchDue()
            └─ for each due reminder:
                 chatProvider.sendMessage(userId, text)
                 update status → 'delivered'
                 if recurring: advance fire_at to next occurrence
```

### New Config Keys

Added to `src/types/config.ts` (`ConfigKey` union + `CONFIG_KEYS` array):

| Key                 | Format                      | Description                                            |
| ------------------- | --------------------------- | ------------------------------------------------------ |
| `briefing_time`     | `"HH:MM"` (24h)             | Local time for morning briefing (e.g. `"08:30"`)       |
| `briefing_timezone` | IANA string                 | User's timezone (e.g. `"America/New_York"`)            |
| `briefing_mode`     | `"short"` \| `"full"`       | Controls briefing verbosity; default `"full"`          |
| `deadline_nudges`   | `"enabled"` \| `"disabled"` | Opt-in gate for all deadline/staleness/blocked alerts  |
| `staleness_days`    | numeric string              | Days of inactivity before staleness alert (e.g. `"7"`) |

### Data Model

#### `reminders`

| Column       | Type    | Description                                                                       |
| ------------ | ------- | --------------------------------------------------------------------------------- |
| `id`         | TEXT PK | UUID                                                                              |
| `user_id`    | TEXT    | Owner                                                                             |
| `text`       | TEXT    | Message to deliver to the user                                                    |
| `task_id`    | TEXT    | Optional: linked task ID (for task-linked reminders)                              |
| `fire_at`    | TEXT    | ISO timestamp of next scheduled fire                                              |
| `recurrence` | TEXT    | Optional: 5-field cron expression (NULL for one-time reminders)                   |
| `status`     | TEXT    | `'pending'` \| `'delivered'` \| `'snoozed'` \| `'cancelled'`; DEFAULT `'pending'` |
| `created_at` | TEXT    | DEFAULT `(datetime('now'))`                                                       |

Indexes: `(user_id)`, `(status, fire_at)` — the second index powers the per-minute "what's due?" poller query.

#### `user_briefing_state`

| Column               | Type    | Description                                                              |
| -------------------- | ------- | ------------------------------------------------------------------------ |
| `user_id`            | TEXT PK | Owner                                                                    |
| `last_briefing_date` | TEXT    | `YYYY-MM-DD` of the last delivered briefing in the user's local timezone |
| `last_briefing_at`   | TEXT    | ISO timestamp of last delivery                                           |

#### `alert_state`

Dual-purpose: tracks last-known task status (for staleness detection) and the most recent alert sent per task/type (for deduplication).

| Column                   | Type    | Description                                                                        |
| ------------------------ | ------- | ---------------------------------------------------------------------------------- |
| `id`                     | TEXT PK | UUID                                                                               |
| `user_id`                | TEXT    | Owner                                                                              |
| `task_id`                | TEXT    | External task ID                                                                   |
| `last_seen_status`       | TEXT    | Task status as of last alert poll                                                  |
| `last_status_changed_at` | TEXT    | ISO timestamp when status last differed from prior poll                            |
| `last_alert_type`        | TEXT    | `'deadline_nudge'` \| `'due_today'` \| `'overdue'` \| `'staleness'` \| `'blocked'` |
| `last_alert_sent_at`     | TEXT    | ISO timestamp of the last alert sent for this task                                 |
| `suppress_until`         | TEXT    | ISO timestamp: no alert of the same type before this time                          |
| `overdue_days_notified`  | INTEGER | How many days-overdue escalations have been sent (for tone escalation)             |
| `created_at`             | TEXT    | DEFAULT `(datetime('now'))`                                                        |

Indexes: `(user_id)`, `(user_id, task_id)` — the second index is used for per-task lookups during the alert cycle.

### Scheduler Architecture

```
Bot startup (src/index.ts)
  └─ initDb()
  └─ RecurringTaskScheduler.start(...)      ← Phase 8
  └─ ProactiveAlertScheduler.start(...)     ← Phase 7 (new)
       └─ register global alertPollerJob    (daily at 06:00 UTC)
       └─ register global reminderPollerJob (every minute)
       └─ for each user with briefing_time configured:
            register perUserBriefingJob with their timezone

ProactiveAlertScheduler.registerBriefingJob(userId, time, tz)
  └─ called when user sets briefing_time config key
  └─ Cron(cronFromTimeAndTz(time, tz), { timezone: tz }, briefingCallback)

ProactiveAlertScheduler.unregisterBriefingJob(userId)
  └─ called when user clears briefing_time

Bot shutdown (SIGINT / SIGTERM)
  └─ ProactiveAlertScheduler.stopAll()
```

`cronFromTimeAndTz(time: string, tz: string): string` — converts `"08:30"` into `"30 8 * * 1-5"` (weekdays only). A `"08:30"` briefing with `weekends: true` option (future) would use `"30 8 * * *"`. For MVP: weekdays only (Mon–Fri).

### First-Message Catch-Up Hook (US3)

The catch-up check sits at the top of `processMessage`, before `callLlm`:

```typescript
// src/llm-orchestrator.ts — top of processMessage
const catchUp = await briefingService.getMissedBriefing(contextId)
if (catchUp !== null) {
  await reply.formatted(catchUp)
}
```

`getMissedBriefing(userId)`:

1. Read `user_briefing_state.last_briefing_date` for the user
2. If `briefing_time` is not configured → return `null`
3. Compute "today" in the user's timezone
4. If `last_briefing_date === today` → return `null` (already delivered)
5. Check whether the briefing time has already passed today → if yes, generate and return a catch-up briefing with a `**(Catch-up briefing — you missed the scheduled delivery)**` header; update `last_briefing_date`
6. Otherwise → return `null` (briefing time hasn't arrived yet)

### LLM Tools

| Tool name             | Description                                             | Input schema (key fields)                                                      |
| --------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `set_reminder`        | Create a one-time or repeating reminder                 | `text`, `fireAt` (ISO timestamp), `recurrence?` (cron), `taskId?`              |
| `list_reminders`      | List the user's active reminders                        | `includeDelivered?` (bool, default false)                                      |
| `cancel_reminder`     | Cancel a pending or snoozed reminder                    | `reminderId`                                                                   |
| `snooze_reminder`     | Snooze a reminder by extending its next fire time       | `reminderId`, `duration` (natural string, e.g. `"1 hour"`, `"30 minutes"`)     |
| `reschedule_reminder` | Move a reminder to an entirely new time                 | `reminderId`, `newFireAt` (ISO timestamp)                                      |
| `get_briefing`        | Manually generate and return today's briefing on demand | `mode?` (`'short'` \| `'full'`; defaults to user's configured `briefing_mode`) |

`set_reminder` tool description instructs the LLM to resolve all natural language time expressions ("tomorrow at 9am", "in 3 hours", "every Friday at 4pm") into explicit `fireAt` ISO timestamps and optional `recurrence` cron strings before calling the tool.

`snooze_reminder` tool description instructs the LLM to convert natural duration strings into explicit ISO timestamps (`fireAt = now + duration`).

### Briefing Sections (Full Mode)

The `BriefingService` assembles up to six sections using task data fetched from the provider:

| Section           | Rule                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------- |
| Due Today         | Tasks with `dueDate == today` and non-terminal status                                     |
| Overdue           | Tasks with `dueDate < today` and non-terminal status                                      |
| In Progress       | Tasks with status slug containing "in-progress" or "in-review"                            |
| Recently Updated  | Tasks whose `last_seen_status` in `alert_state` changed within the last 24h               |
| Newly Assigned    | Tasks assigned to the user with `created_at` in the last 24h (where available)            |
| Suggested Actions | Top 3 deterministic priorities: overdue first, then urgent due-today, then high due-today |

Short mode (US2) replaces all sections with a single line of counts, e.g. `3 due today · 2 overdue · 5 in progress`.

**Briefing format**: The message opens with `**📋 Morning Briefing — {date}**` (or `**(Catch-up briefing)**` for US3). Each section is a bold header followed by a Markdown-linked task list.

### File Structure

```
src/
  proactive/
    index.ts          ← public exports: ProactiveAlertScheduler, services, tools
    types.ts          ← ReminderStatus, AlertType, BriefingMode, BriefingSection
    service.ts        ← ProactiveAlertService (deadline, staleness, blocked checks)
    briefing.ts       ← BriefingService (generate, getMissedBriefing)
    reminders.ts      ← ReminderService (CRUD + fetchDue)
    scheduler.ts      ← ProactiveAlertScheduler (croner wiring)
    tools.ts          ← set_reminder, list_reminders, cancel_reminder, snooze_reminder,
                        reschedule_reminder, get_briefing
  db/
    migrations/
      010_proactive_alerts.ts   ← reminders + user_briefing_state + alert_state tables
  types/
    config.ts         ← extended with 5 new config keys

tests/
  proactive/
    service.test.ts
    briefing.test.ts
    reminders.test.ts
    scheduler.test.ts
    tools.test.ts
```

**Modified files**: `src/db/schema.ts`, `src/db/index.ts`, `src/types/config.ts`, `src/llm-orchestrator.ts`, `src/tools/index.ts`, `src/index.ts`

---

## Detailed Task Breakdown

### Phase 1 — DB Schema & Migration (0.5 days)

#### Task 1.1 — Create `src/db/migrations/010_proactive_alerts.ts`

- **File**: `src/db/migrations/010_proactive_alerts.ts` (new)
- **Change**: `CREATE TABLE reminders (...)`, `CREATE TABLE user_briefing_state (...)`, `CREATE TABLE alert_state (...)` with all columns and indexes defined in the data model section above.
- **Estimate**: 0.5h ±0.25h | **Priority**: Blocker
- **Acceptance Criteria**:
  - Migration runs cleanly on a DB with migrations 001–009 already applied
  - All three tables and all indexes present after `initDb()`
  - `bun typecheck` passes with no errors
- **Dependencies**: Phase 8 migration 009 registered in `src/db/index.ts`

#### Task 1.2 — Add Drizzle schema definitions to `src/db/schema.ts`

- **File**: `src/db/schema.ts`
- **Change**: Add `reminders`, `userBriefingState`, and `alertState` table definitions using `sqliteTable`. Export inferred types: `Reminder`, `UserBriefingState`, `AlertStateRow`.
- **Estimate**: 0.5h ±0.25h | **Priority**: High
- **Acceptance Criteria**:
  - `typeof reminders.$inferSelect` matches the data model column set exactly
  - `typeof alertState.$inferSelect` includes all columns including `overdueDaysNotified`
  - `bun typecheck` passes
- **Dependencies**: Task 1.1

#### Task 1.3 — Register migration 010 in `src/db/index.ts`

- **File**: `src/db/index.ts`
- **Change**: Import `migration010ProactiveAlerts` and append to `MIGRATIONS` array after `migration009RecurringTasks`.
- **Estimate**: 0.1h ±0 | **Priority**: Blocker
- **Acceptance Criteria**: `initDb()` applies all 10 migrations without error
- **Dependencies**: Tasks 1.1, Phase 8 Task 1.1 (migration 008 registered) and Phase 8 Task 1.2 (migration 009 registered)

#### Task 1.4 — Extend `ConfigKey` in `src/types/config.ts`

- **File**: `src/types/config.ts`
- **Change**: Add `'briefing_time' | 'briefing_timezone' | 'briefing_mode' | 'deadline_nudges' | 'staleness_days'` to the `ConfigKey` union and to the `CONFIG_KEYS` readonly array.
- **Estimate**: 0.1h ±0 | **Priority**: High
- **Acceptance Criteria**: `isConfigKey('briefing_time')` returns `true`; no `bun typecheck` errors
- **Dependencies**: None

---

### Phase 2 — Types (0.25 days)

#### Task 2.1 — Create `src/proactive/types.ts`

- **File**: `src/proactive/types.ts` (new)
- **Change**: Define the following:
  - `ReminderStatus = 'pending' | 'delivered' | 'snoozed' | 'cancelled'`
  - `AlertType = 'deadline_nudge' | 'due_today' | 'overdue' | 'staleness' | 'blocked'`
  - `BriefingMode = 'short' | 'full'`
  - `BriefingSection = { title: string; tasks: BriefingTask[] }`
  - `BriefingTask = { id: string; title: string; url?: string; dueDate?: string | null; status?: string }`
  - `CreateReminderParams = { userId: string; text: string; fireAt: string; recurrence?: string; taskId?: string }`
  - `AlertCheckResult = { sent: number; suppressed: number }`
- **Estimate**: 0.25h ±0 | **Priority**: High
- **Dependencies**: None

---

### Phase 3 — Services (2 days)

#### Task 3.1 — Create `src/proactive/reminders.ts`

- **File**: `src/proactive/reminders.ts` (new)
- **Exports**: `ReminderService` class.

  | Method                                              | Description                                                                                                         |
  | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
  | `createReminder(params)`                            | INSERT into reminders; return created row                                                                           |
  | `listReminders(userId, includeDelivered)`           | SELECT reminders; filter out 'cancelled' always; optionally include 'delivered'                                     |
  | `cancelReminder(reminderId, userId)`                | UPDATE `status = 'cancelled'`; verify ownership                                                                     |
  | `snoozeReminder(reminderId, userId, newFireAt)`     | UPDATE `status = 'snoozed'`, `fire_at = newFireAt`; verify ownership                                                |
  | `rescheduleReminder(reminderId, userId, newFireAt)` | UPDATE `fire_at = newFireAt`, `status = 'pending'`; verify ownership                                                |
  | `fetchDue()`                                        | SELECT all rows WHERE `status IN ('pending','snoozed') AND fire_at <= datetime('now')`                              |
  | `markDelivered(reminderId)`                         | UPDATE `status = 'delivered'`                                                                                       |
  | `advanceRecurrence(reminderId)`                     | For recurring reminders: compute next fire using croner's `Cron` `.nextRun()`, UPDATE `fire_at`, reset to 'pending' |

  Ownership check: all mutation methods SELECT by `(id, user_id)` and throw `providerError.notFound('reminder', reminderId)` if not found.

- **Estimate**: 2h ±0.5h | **Priority**: High
- **Acceptance Criteria**:
  - `createReminder` with a `recurrence` stores the cron expression and returns `status = 'pending'`
  - `fetchDue` returns only rows past their `fire_at` with `status` in `('pending','snoozed')`
  - `advanceRecurrence` leaves the `status` as `'pending'` and updates `fire_at` to the next cron date
  - Ownership violation throws `AppError` with type `'provider'` and code `'not-found'`
- **Dependencies**: Tasks 1.2, 2.1

#### Task 3.2 — Create `src/proactive/service.ts`

- **File**: `src/proactive/service.ts` (new)
- **Exports**: `ProactiveAlertService` class.

  | Method                                                        | Description                                                                                                                                                         |
  | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `runAlertCycle(userId, provider, sendFn)`                     | Full scan: deadline nudges, due-today, overdue escalation, staleness, blocked. Calls `sendFn(userId, message)` for each non-suppressed alert                        |
  | `runAlertCycleForAllUsers(provider, sendFn)`                  | Fetch all users with `deadline_nudges = 'enabled'`; call `runAlertCycle` for each in sequence                                                                       |
  | `checkDeadlineNudge(userId, task)`                            | Returns alert message if task is due tomorrow (in user's tz) and not suppressed                                                                                     |
  | `checkDueToday(userId, task)`                                 | Returns alert message if task is due today and not suppressed                                                                                                       |
  | `checkOverdue(userId, task)`                                  | Returns escalated alert message based on `overdue_days_notified`; escalation tiers: 1–2 days = soft, 3–5 = moderate, 6+ = urgent daily                              |
  | `checkStaleness(userId, task, thresholdDays)`                 | Compares `last_status_changed_at` to now; returns alert if inactive for ≥ thresholdDays                                                                             |
  | `checkBlocked(userId, task)`                                  | Returns alert if task has a `blocked_by` relation, the blocker is non-terminal, and `dueDate ≤ tomorrow`                                                            |
  | `updateAlertState(userId, taskId, currentStatus, alertType?)` | Upsert `alert_state`: update `last_seen_status`; if status changed, reset `last_status_changed_at`; if alert sent, update `last_alert_sent_at` and `suppress_until` |

  **Escalation tone tiers** (overdue):
  - 1–2 days overdue: `"⚠️ TASK-X is 1 day overdue. Please update its status."`
  - 3–5 days overdue: `"🔴 TASK-X is 3 days overdue. Please resolve or escalate."`
  - 6+ days overdue: `"🚨 TASK-X is now X days overdue. Immediate action required."`

  **Suppression windows** (configurable constants, not user-facing for MVP):
  - `deadline_nudge`: 20 hours (one per day)
  - `due_today`: 20 hours
  - `overdue`: 20 hours (fires once per day)
  - `staleness`: 72 hours (re-alert every 3 days while still stale)
  - `blocked`: 20 hours

  **Terminal status detection**: A task is "terminal" (done / won't-fix / cancelled) when its status slug is in a configurable constant `TERMINAL_STATUS_SLUGS`. Default: `['done', 'completed', 'won\'t fix', 'cancelled', 'archived']` (case-insensitive substring match). The alert service skips terminal tasks entirely, cleans up their `alert_state` rows.

- **Estimate**: 4h ±1h | **Priority**: High
- **Acceptance Criteria**:
  - `checkOverdue` with `overdue_days_notified = 0` returns a soft tone message
  - `checkOverdue` with `overdue_days_notified = 6` returns an urgent tone message
  - A suppressed task (within `suppress_until`) returns `null` from all check methods
  - A terminal task returns `null` from all check methods
  - `updateAlertState` resets `last_status_changed_at` when `currentStatus !== last_seen_status`
- **Dependencies**: Tasks 1.2, 2.1

#### Task 3.3 — Create `src/proactive/briefing.ts`

- **File**: `src/proactive/briefing.ts` (new)
- **Exports**: `BriefingService` class.

  | Method                                        | Description                                                                                                      |
  | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
  | `generate(userId, provider, mode)`            | Fetch tasks from all provider projects; assemble sections; format markdown; update `user_briefing_state`         |
  | `getMissedBriefing(userId, provider)`         | Check if today's briefing was missed; generate and return it with catch-up header if so; return `null` otherwise |
  | `buildSections(userId, tasks, alertStateMap)` | Classify tasks into the six sections; return `BriefingSection[]`                                                 |
  | `formatFull(date, sections)`                  | Render full briefing markdown with section headers and Markdown task links                                       |
  | `formatShort(date, sections)`                 | Render short briefing as single summary line: `"3 due today · 2 overdue · 5 in progress"`                        |
  | `suggestActions(sections)`                    | Return top 3 tasks: overdue first, then urgent due-today, then high due-today                                    |

  **Task fetch strategy**: call `listProjects()` (if available) then `listTasks(projectId)` for each project. If `listProjects` is not available, use `searchTasks({ query: '' })` as fallback. Filter results in-memory against the date and status rules. Terminal tasks are excluded from all sections.

  **`getMissedBriefing` logic**:
  1. If `briefing_time` is not configured for the user → return `null`
  2. Read `user_briefing_state.last_briefing_date`
  3. Compute today in the user's `briefing_timezone` (fallback: UTC)
  4. If `last_briefing_date === today` → return `null`
  5. Parse `briefing_time` and check if it has already passed in the user's timezone
  6. If yes: generate briefing, prepend `"**(Catch-up — missed {briefingTime} briefing)**\n\n"`, update `last_briefing_date`
  7. If no: return `null` (wait for the scheduled job)

- **Estimate**: 3h ±1h | **Priority**: High
- **Acceptance Criteria**:
  - `generate` with `mode = 'short'` returns a single summary line, no section headers
  - `generate` with `mode = 'full'` includes all six section headers (even if empty sections are omitted)
  - `getMissedBriefing` returns `null` when briefing was already delivered today
  - `getMissedBriefing` returns a catch-up string when briefing time has passed and briefing not yet delivered
  - `getMissedBriefing` returns `null` when briefing time has not yet arrived today
  - `suggestActions` returns ≤3 tasks, prioritised: overdue > urgent-due-today > high-due-today
- **Dependencies**: Tasks 1.2, 2.1, 3.2

---

### Phase 4 — Scheduler (1 day)

#### Task 4.1 — Confirm or add `croner` dependency

- **File**: `package.json`
- **Change**: If `croner` is not present (i.e., Phase 8 was not yet implemented), add `"croner": "^9.0.0"` to `dependencies`. If already present, this task is a no-op.
- **Estimate**: 0.1h ±0 | **Priority**: Blocker
- **Dependencies**: None

#### Task 4.2 — Create `src/proactive/scheduler.ts`

- **File**: `src/proactive/scheduler.ts` (new)
- **Exports**: `ProactiveAlertScheduler` class (singleton).

  | Method                                                                         | Description                                                                                                               |
  | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
  | `start(alertService, briefingService, reminderService, chat, provider)`        | Register global alert poller and reminder poller; load all users with `briefing_time` and register per-user briefing jobs |
  | `registerBriefingJob(userId, time, timezone, briefingService, chat, provider)` | Create `Cron("M H * * 1-5", { timezone }, callback)` using `cronFromTimeAndTz`; store in `Map<userId, Cron>`              |
  | `unregisterBriefingJob(userId)`                                                | Stop and delete the briefing cron job for this user                                                                       |
  | `stopAll()`                                                                    | Stop all registered cron jobs (briefing + global pollers)                                                                 |

  **Global pollers**:
  - `alertPollerJob`: `Cron("0 6 * * *", ...)` — daily at 06:00 UTC, calls `alertService.runAlertCycleForAllUsers(provider, chat.sendMessage)`
  - `reminderPollerJob`: `Cron("* * * * *", ...)` — every minute, calls `reminderService.fetchDue()` and sends each due reminder

  **Per-user briefing**: `cronFromTimeAndTz("08:30") → "30 8 * * 1-5"`. On each fire, calls `briefingService.generate(userId, provider, mode)` then `chat.sendMessage(userId, markdown)`.

  **Error handling**: All job callbacks catch and log errors via `logger.child({ scope: 'proactive:scheduler' })`; errors never propagate to the croner runtime.

- **Estimate**: 2.5h ±0.5h | **Priority**: High
- **Acceptance Criteria**:
  - `start()` with 2 users having `briefing_time` configured registers 2 per-user cron jobs + 2 global jobs = 4 total
  - `registerBriefingJob` for an existing `userId` replaces the previous job (stops old, starts new)
  - `unregisterBriefingJob` for a user with no job is a no-op (no error)
  - An error thrown inside a briefing callback is logged and does not crash the scheduler
  - `stopAll()` stops all registered jobs
- **Dependencies**: Tasks 3.1, 3.2, 3.3, 4.1

#### Task 4.3 — Wire scheduler into `src/index.ts`

- **File**: `src/index.ts`
- **Change**:
  1. Import and instantiate `ReminderService`, `ProactiveAlertService`, `BriefingService`, `ProactiveAlertScheduler`
  2. After `initDb()` and after `RecurringTaskScheduler.start(...)` (Phase 8), call `await ProactiveAlertScheduler.start(...)`
  3. In `SIGINT` and `SIGTERM` handlers, call `ProactiveAlertScheduler.stopAll()`
- **Estimate**: 0.5h ±0.25h | **Priority**: High
- **Acceptance Criteria**: Bot startup log includes a message: `"Proactive alert scheduler started: N briefing jobs, 2 global pollers registered"`
- **Dependencies**: Task 4.2

---

### Phase 5 — LLM Tools (1 day)

#### Task 5.1 — Create `src/proactive/tools.ts`

- **File**: `src/proactive/tools.ts` (new)
- **Exports**: `makeProactiveTools(reminderService, briefingService, scheduler): ToolSet` returning all 6 tools.

  | Tool                  | Key validations / side-effects                                                                                                                                                                                                                                                               |
  | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `set_reminder`        | Parse `fireAt` (must be a valid ISO timestamp, must be in the future); if `recurrence` present, validate with `Cron.validate()`; call `reminderService.createReminder`; if `recurrence` is set and a croner job is needed for exact timing, the scheduler's reminder poller handles delivery |
  | `list_reminders`      | Calls `reminderService.listReminders(userId, includeDelivered)`                                                                                                                                                                                                                              |
  | `cancel_reminder`     | Calls `reminderService.cancelReminder(reminderId, userId)`; ownership enforced in service                                                                                                                                                                                                    |
  | `snooze_reminder`     | LLM passes an already-resolved ISO timestamp for `newFireAt`; calls `reminderService.snoozeReminder`                                                                                                                                                                                         |
  | `reschedule_reminder` | LLM passes an already-resolved ISO timestamp for `newFireAt`; calls `reminderService.rescheduleReminder`                                                                                                                                                                                     |
  | `get_briefing`        | Calls `briefingService.generate(userId, provider, mode ?? configuredMode)`; does NOT update `last_briefing_date` (manual trigger, not the same as a scheduled delivery)                                                                                                                      |

  All tools extract `userId` from the tool call context (passed via closure from `makeProactiveTools` caller).

- **Estimate**: 2h ±0.5h | **Priority**: High
- **Acceptance Criteria**:
  - `set_reminder` with a past `fireAt` returns a `{ error }` object, not a thrown exception
  - `set_reminder` with an invalid cron expression returns a `{ error: "Invalid recurrence expression: ..." }` object
  - `cancel_reminder` for a reminder owned by a different user returns the `AppError` not-found message
  - `get_briefing` with no mode uses the user's configured `briefing_mode`; falls back to `'full'`
- **Dependencies**: Tasks 3.1, 3.3, 4.2

#### Task 5.2 — Register proactive tools in `src/tools/index.ts`

- **File**: `src/tools/index.ts`
- **Change**: Extend `makeTools(provider, options?)` to accept optional `{ reminderService, briefingService, scheduler }`. Merge the result of `makeProactiveTools(...)` into the returned `ToolSet` when these are provided.
- **Estimate**: 0.25h ±0 | **Priority**: High
- **Acceptance Criteria**: `Object.keys(makeTools(provider, { reminderService, briefingService, scheduler }))` includes all 6 proactive tool names; calling `makeTools(provider)` without options continues to work as before
- **Dependencies**: Task 5.1

---

### Phase 6 — First-Message Catch-Up Hook (0.5 days)

#### Task 6.1 — Add catch-up check to `src/llm-orchestrator.ts`

- **File**: `src/llm-orchestrator.ts`
- **Change**: Inject `briefingService` as an optional parameter to `processMessage`. At the top of `processMessage`, before `callLlm`, call `briefingService?.getMissedBriefing(contextId, provider)`. If a non-null string is returned, call `await reply.formatted(catchUp)` before proceeding with the LLM response.

  The injected `briefingService` is threaded from `src/bot.ts` → `processMessage`. The `bot.ts` `onMessage` handler receives it via closure when `setupBot` is called.

  `setupBot` signature change: `setupBot(chat, adminUserId, { briefingService? }?)` — optional second arg keeps all existing callers working.

- **Estimate**: 1h ±0.25h | **Priority**: High
- **Acceptance Criteria**:
  - When the user sends their first message after missing a briefing, the response starts with the catch-up briefing then the LLM reply
  - When `briefingService` is not provided (e.g. in tests), no error is thrown
  - When the briefing time has not yet arrived, no catch-up is prepended
  - Existing test suite (`bun test`) continues to pass with no changes required to test setup
- **Dependencies**: Task 3.3

---

### Phase 7 — Tests (1.5 days)

#### Task 7.1 — Create `tests/proactive/service.test.ts`

- **File**: `tests/proactive/service.test.ts` (new)
- **Setup**: In-memory DB with migrations 001–010, `drizzle-orm/bun-sqlite`, mock `TaskProvider` returning configurable task lists.
- **Test cases**:
  1. `checkDeadlineNudge returns message for task due tomorrow`
  2. `checkDeadlineNudge returns null for task due in 3 days`
  3. `checkDueToday returns message for task due today`
  4. `checkDueToday returns null if already suppressed within window`
  5. `checkOverdue with 0 prior notifications returns soft tone`
  6. `checkOverdue with 3 prior notifications returns moderate tone`
  7. `checkOverdue with 7 prior notifications returns urgent tone`
  8. `checkOverdue returns null for terminal task`
  9. `checkStaleness returns message when inactive for threshold days`
  10. `checkStaleness returns null when status changed within threshold`
  11. `checkBlocked returns message when blocker is non-terminal and due ≤ tomorrow`
  12. `checkBlocked returns null when blocker is terminal`
  13. `updateAlertState resets last_status_changed_at when status differs`
  14. `updateAlertState does not reset last_status_changed_at when status is unchanged`
  15. `runAlertCycleForAllUsers skips users without deadline_nudges = enabled`
- **Estimate**: 2.5h ±0.5h | **Priority**: High
- **Dependencies**: Task 3.2

#### Task 7.2 — Create `tests/proactive/reminders.test.ts`

- **File**: `tests/proactive/reminders.test.ts` (new)
- **Setup**: In-memory DB with migrations 001–010.
- **Test cases**:
  1. `createReminder stores row with status = pending`
  2. `createReminder with recurrence stores cron expression`
  3. `listReminders excludes cancelled reminders`
  4. `listReminders includes delivered when includeDelivered = true`
  5. `cancelReminder sets status to cancelled`
  6. `cancelReminder throws not-found for wrong userId`
  7. `snoozeReminder sets status to snoozed and updates fire_at`
  8. `fetchDue returns only past-fire_at rows with pending or snoozed status`
  9. `fetchDue excludes delivered and cancelled rows`
  10. `advanceRecurrence updates fire_at to next cron occurrence and resets to pending`
  11. `markDelivered sets status to delivered`
- **Estimate**: 1.5h ±0.5h | **Priority**: High
- **Dependencies**: Task 3.1

#### Task 7.3 — Create `tests/proactive/briefing.test.ts`

- **File**: `tests/proactive/briefing.test.ts` (new)
- **Setup**: In-memory DB with migrations 001–010, mock `TaskProvider`.
- **Test cases**:
  1. `generate in short mode returns single summary line`
  2. `generate in full mode returns section headers in markdown`
  3. `generate updates user_briefing_state.last_briefing_date`
  4. `suggestActions returns overdue tasks before urgent due-today`
  5. `suggestActions returns at most 3 tasks`
  6. `getMissedBriefing returns null when briefing_time not configured`
  7. `getMissedBriefing returns null when last_briefing_date is today`
  8. `getMissedBriefing returns catch-up string when briefing time has passed`
  9. `getMissedBriefing returns null when briefing time has not yet arrived`
  10. `getMissedBriefing catch-up string includes (Catch-up) header`
  11. `buildSections correctly partitions tasks into due-today, overdue, in-progress`
- **Estimate**: 2h ±0.5h | **Priority**: High
- **Dependencies**: Task 3.3

#### Task 7.4 — Create `tests/proactive/scheduler.test.ts`

- **File**: `tests/proactive/scheduler.test.ts` (new)
- **Setup**: Mock `croner` (stub `Cron` class with `stop()` spy). Mock all three services. Mock `ChatProvider`.
- **Test cases**:
  1. `start() registers 2 global poller jobs`
  2. `start() registers one briefing job per user with briefing_time configured`
  3. `registerBriefingJob stops existing job before creating a new one for same userId`
  4. `unregisterBriefingJob is a no-op when userId has no job`
  5. `stopAll stops all registered cron jobs`
  6. `briefing callback error is caught and logged, not rethrown`
  7. `alert poller callback error is caught and logged, not rethrown`
  8. `reminder poller marks reminder as delivered after sending`
  9. `reminder poller calls advanceRecurrence for recurring reminder after delivery`
- **Estimate**: 1.5h ±0.5h | **Priority**: High
- **Dependencies**: Task 4.2

#### Task 7.5 — Create `tests/proactive/tools.test.ts`

- **File**: `tests/proactive/tools.test.ts` (new)
- **Setup**: Mock `ReminderService`, `BriefingService`, `ProactiveAlertScheduler`.
- **Test cases** (grouped by tool):

  **`set_reminder`**
  1. `creates reminder and returns confirmation`
  2. `returns error object for past fireAt`
  3. `returns error object for invalid cron expression`

  **`list_reminders`** 4. `returns formatted list of pending reminders` 5. `returns empty message when no reminders`

  **`cancel_reminder`** 6. `calls service.cancelReminder and returns confirmation` 7. `surfaces not-found error for unknown reminderId`

  **`snooze_reminder`** 8. `calls service.snoozeReminder and returns new fire_at`

  **`reschedule_reminder`** 9. `calls service.rescheduleReminder and returns confirmation`

  **`get_briefing`** 10. `calls briefingService.generate with configured mode` 11. `falls back to full mode when briefing_mode not configured`

- **Estimate**: 1.5h ±0.5h | **Priority**: High
- **Dependencies**: Task 5.1

---

### Phase 8 — Integration & Wiring (0.5 days)

#### Task 8.1 — Thread proactive services through `src/tools/index.ts`

- **File**: `src/tools/index.ts` and `src/llm-orchestrator.ts`
- **Change**: The `makeTools` and `getOrCreateTools` functions receive the optional `{ reminderService, briefingService, scheduler }` options object and pass them through. The tools cache key remains `contextId`; cache invalidation is unchanged (tools are recreated on config change).
- **Estimate**: 0.5h ±0.25h | **Priority**: High
- **Dependencies**: Tasks 5.2, 6.1

#### Task 8.2 — Instantiate services and scheduler in `src/index.ts`

- **File**: `src/index.ts`
- **Change**:
  1. Import `ReminderService`, `ProactiveAlertService`, `BriefingService`, `ProactiveAlertScheduler`
  2. Instantiate each after `initDb()`
  3. Call `await ProactiveAlertScheduler.start(alertService, briefingService, reminderService, chatProvider, providerFactory)` after Phase 8's `RecurringTaskScheduler.start(...)` — services are started after all DB migrations complete
  4. Pass `{ briefingService }` to `setupBot(...)`
  5. Call `ProactiveAlertScheduler.stopAll()` in both `SIGINT` and `SIGTERM` handlers
- **Estimate**: 0.5h ±0.25h | **Priority**: High
- **Dependencies**: Tasks 4.3, 8.1

---

## Risk Assessment Matrix

| Risk                                                                                   | Probability | Impact | Mitigation                                                                                                                                                                       | Owner |
| -------------------------------------------------------------------------------------- | ----------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `listTasks` called per-project across all users is slow at scale                       | Medium      | Medium | Alert poller runs once daily; cache task list per user per run within the same cycle; add configurable `max_projects_per_alert_scan` constant (default: 20)                      | Dev   |
| Croner briefing job misfires during DST transition (clock goes back)                   | Low         | Medium | Croner's `{ timezone }` option handles DST correctly via IANA database; no manual adjustment needed                                                                              | Dev   |
| LLM passes malformed ISO timestamps or relative times to `set_reminder`                | Medium      | Low    | Validate `fireAt` in tool execute: `Date.parse(fireAt) > Date.now()` before INSERT; return actionable error string                                                               | Dev   |
| First-message catch-up calls `listTasks` before the user's task provider is configured | Medium      | Medium | `getMissedBriefing` returns `null` early if task provider config is missing (same guard as `callLlm`); catch-up is silently skipped                                              | Dev   |
| `runAlertCycleForAllUsers` sends duplicate alerts if bot restarts mid-sweep            | Low         | Medium | `suppress_until` is set before `sendMessage`; even if the send fails, the record is there; consider transactional approach only if reports of duplicates emerge                  | Dev   |
| Staleness alert fires for a task the user already knows about                          | Low         | Low    | 72-hour suppression window for staleness alerts; user can configure `staleness_days` to a higher threshold                                                                       | Dev   |
| Reminder poller runs every minute but bot may have many users with many reminders      | Low         | Low    | Query uses `(status, fire_at)` index; result set is small (only due reminders); no concern for reasonable scale                                                                  | Dev   |
| Phase 8 not yet implemented when Phase 7 work begins                                   | Medium      | Medium | Phase 7 Task 4.1 handles croner installation as a conditional no-op; migration numbering assumes Phase 8 is done; if implementing Phase 7 first, renumber migrations accordingly | Dev   |

---

## Resource Requirements

- **Development Hours**: 32h ±5h total (7–8 working days)
- **New Production Dependencies**: None (reuses `croner` from Phase 8; all other needs covered by `drizzle-orm`, `zod`, existing stack)
- **New Dev Dependencies**: None
- **Database Changes**: 3 new tables, 5 new indexes, 1 migration file (010)
- **New Source Files**: 7 (`src/proactive/index.ts`, `scheduler.ts`, `service.ts`, `briefing.ts`, `reminders.ts`, `tools.ts`, `types.ts`, `src/db/migrations/010_proactive_alerts.ts`)
- **Modified Source Files**: `src/db/schema.ts`, `src/db/index.ts`, `src/types/config.ts`, `src/llm-orchestrator.ts`, `src/tools/index.ts`, `src/bot.ts`, `src/index.ts`
- **New Test Files**: 5 (`tests/proactive/service.test.ts`, `briefing.test.ts`, `reminders.test.ts`, `scheduler.test.ts`, `tools.test.ts`)
- **Modified Test Files**: None (all proactive tests are additive)
- **Skills Required**: Cron expression format, IANA timezone handling, SQLite schema design, Drizzle ORM, `bun:test` mock patterns, chat provider `sendMessage` API

---

## Planning Quality Gates

**✅ Requirements Coverage**

- [x] US1 (morning briefing) → Tasks 1.4, 3.3, 4.2, 4.3, 7.3, 7.4
- [x] US2 (short vs full mode) → Task 1.4 (`briefing_mode` config), 3.3 (`formatShort`/`formatFull`), 7.3
- [x] US3 (missed briefing catch-up) → Tasks 3.3 (`getMissedBriefing`), 6.1, 7.3
- [x] US4 (pre-deadline nudge) → Tasks 3.2 (`checkDeadlineNudge`), 4.2, 7.1
- [x] US5 (due-day + overdue escalation) → Tasks 3.2 (`checkDueToday`, `checkOverdue`), 4.2, 7.1
- [x] US6 (staleness alert) → Tasks 1.1 (`alert_state`), 3.2 (`checkStaleness`), 7.1
- [x] US7 (blocked task near deadline) → Tasks 3.2 (`checkBlocked`), 7.1
- [x] US8 (one-time reminders) → Tasks 1.1 (`reminders`), 3.1, 4.2, 5.1 (`set_reminder`), 7.2, 7.5
- [x] US9 (repeating reminders) → Tasks 3.1 (`recurrence` + `advanceRecurrence`), 7.2
- [x] US10 (snooze, reschedule, act, dedup) → Tasks 3.1 (`snoozeReminder`, `rescheduleReminder`), 1.1 (`suppress_until`), 5.1, 7.5

**✅ Library Research Validation**

- [x] `croner` v9 reused from Phase 8 — zero additional dependencies, MIT, Bun-compatible
- [x] No NL date-parsing library needed — LLM resolves all natural language to ISO timestamps
- [x] No date arithmetic library needed — `Date` built-in and SQLite `datetime()` suffice
- [x] Timezone handling: croner's `{ timezone }` option covers per-user briefing scheduling

**✅ Risk Management**

- [x] Alert flood prevention: per-alert-type suppression windows prevent duplicate nudges
- [x] Escalation caps: overdue tone increases but caps at "urgent daily" — no infinite escalation escalation
- [x] Catch-up guard: skips gracefully when provider not configured
- [x] Croner DST safety: IANA timezone aware

**✅ Tracking Framework**

- [x] 8 phases with clear file-level deliverables
- [x] Every task has measurable acceptance criteria
- [x] Test counts: 15 service + 11 reminder + 11 briefing + 9 scheduler + 11 tool = 57 new tests minimum

**✅ Phase 8 Alignment**

- [x] Same `croner` library and version
- [x] Same scheduler singleton pattern (`Map<id, Cron>`, `start/register/unregister/stopAll`)
- [x] Same `makeXxxTool(service, ...)` tool factory convention
- [x] Same Drizzle ORM query patterns and migration convention
- [x] Migration numbering follows Phase 8 (010 after Phase 8's 009)
- [x] Both schedulers wired in `src/index.ts` with `stopAll()` in shutdown handlers
- [x] `croner` installation in Phase 7 is a conditional no-op if Phase 8 already added it
