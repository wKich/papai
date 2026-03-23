# Deferred LLM Prompts for Proactive Features

**Created**: 2026-03-23
**Status**: Proposed

---

## Problem

Briefings, alerts, and reminders are currently implemented as code-driven pipelines that bypass the LLM entirely:

- **Briefings**: Scheduler fires → `fetchAllTasks()` → hardcoded markdown template → `sendMessage()`
- **Alerts**: Hourly poller → `checkDeadlineNudge()` / `checkOverdue()` / `checkStaleness()` / `checkBlocked()` → hardcoded strings → `sendMessage()`
- **Reminders**: Timer fires → `sendMessage('🔔 Reminder: ' + text)`

This means the LLM is never involved. The messages are rigid templates, they cannot adapt to context, and they cannot take initiative beyond what the hardcoded logic prescribes. A task with a note saying "this is expected to be delayed" still gets an overdue escalation. A reminder for "review the PR" doesn't fetch the current PR status.

---

## Decision

Replace all three code-driven pipelines with **deferred LLM prompts**: at the scheduled time, the scheduler calls the LLM with a crafted system prompt describing the situation, gives it full tool access, and delivers whatever the LLM produces to the user.

This is identical to how the bot responds to user messages, except:

- The trigger is the scheduler, not a user
- The "user" message is an internal instruction, not visible to the human
- The conversation is ephemeral — it is not appended to the user's persistent history

The user experiences the result exactly the same as they do today (a message from the bot), but the content is now LLM-generated: contextual, natural, and capable of reasoning.

---

## New Entry Point: `processScheduledPrompt`

A new function in `src/llm-orchestrator.ts` (or `src/proactive/deferred.ts`):

```typescript
export async function processScheduledPrompt(
  userId: string,
  systemContext: string,
  prompt: string,
  sendFn: (userId: string, message: string) => Promise<void>,
): Promise<void>
```

Behaviour:

1. Checks required config (LLM key, base URL, model, task provider key). Silently returns if missing — no message sent for a misconfigured scheduled event.
2. Builds the LLM client and task provider for `userId`.
3. Assembles tools: full task tools (`makeTools`) + alert-state tools (see below). **No** reminder management tools — scheduled prompts cannot create new reminders for themselves.
4. Calls `generateText` with:
   - `system`: a compact base prompt containing today's date/time in the user's timezone, followed by `systemContext`
   - `messages`: a single `user` message containing `prompt`
   - No prior conversation history — each scheduled invocation is a fresh context
5. If the LLM produces non-empty text, calls `sendFn(userId, text)`.
6. If the LLM produces empty text (it decided nothing is worth saying), does nothing.
7. Does **not** append anything to `conversationHistory`. Does **not** run `runTrimInBackground`.
8. Errors are caught, logged, and swallowed — a failed scheduled delivery must never crash the scheduler.

The existing `processMessage` path is unchanged. Scheduled prompts are entirely parallel to user-initiated conversations.

---

## Feature Design

### 1. Morning Briefing

**Trigger**: Per-user `setInterval` registered by `configure_briefing` (HH:MM in user's timezone). Weekday-only enforcement is left to the LLM system context (see below) or can remain as a cron expression gate.

**System context** passed to `processScheduledPrompt`:

```
This is an automated morning briefing. The user has configured you to send them a
briefing at this time each day.

Fetch all projects and their tasks. Produce a full morning briefing covering:
- Tasks due today
- Overdue tasks (sorted by how many days overdue)
- Tasks currently in progress
- Tasks whose status changed in the last 24 hours
- 2–3 suggested priority actions for the day

Format the briefing in clear markdown. Be concise and actionable. If nothing
requires attention, say so briefly and warmly.

Record that the briefing was delivered by calling record_briefing_delivery.
```

**Prompt** (the "user" turn the LLM sees): `"Generate the morning briefing."`

**What the LLM does**: calls `list_projects`, `list_tasks` per project, optionally `get_task` for context, then writes the briefing, then calls `record_briefing_delivery`.

**Catch-up (missed briefing)**: The existing logic in `processMessage` that detects a missed briefing and prepends it to the user's first reply stays. Instead of calling `briefingService.generateAndRecord`, it calls `processScheduledPrompt` with a catch-up variant of the system context:

```
The user's briefing was scheduled for ${briefingTime} but was not delivered. Deliver
it now as a catch-up. Prefix the briefing with "(Catch-up — missed ${briefingTime} briefing)".
[... same instructions as above ...]
```

**`record_briefing_delivery` tool**: a narrow tool available only inside scheduled prompts that writes today's date to `user_briefing_state`. This is what `getMissedBriefing` checks to avoid double-delivery.

---

### 2. Deadline and Staleness Alerts

**Trigger**: Global hourly poller — for each user with `deadline_nudges = 'enabled'`, calls `processScheduledPrompt`.

**System context**:

```
This is an automated alert check. The user has opted in to proactive deadline and
staleness alerts.

Fetch all projects and their tasks. For each non-terminal task, check whether any
of the following alert conditions apply. For each condition that applies, call
send_alert(taskId, alertType, message) to deliver it. That tool checks the
suppression window and deduplicates automatically — call it freely for every
condition you detect; it will silently skip anything that was recently alerted.

Alert conditions to check:
- DEADLINE_NUDGE: task is due tomorrow and not yet done → "📅 [Task] is due
  tomorrow. Make sure it's on track."
- DUE_TODAY: task is due today and not done → "⏰ [Task] is due today."
- OVERDUE: task is past its due date → escalate based on days overdue:
    1–2 days: "⚠️ [Task] is N days overdue. Please update its status."
    3–5 days: "🔴 [Task] is N days overdue. Please resolve or escalate."
    6+ days:  "🚨 [Task] is now N days overdue. Immediate action required."
- STALENESS: task has been in the same status for more than ${stalenessDays} days
  → "🕸️ [Task] has been in '[status]' for N days with no activity."
- BLOCKED: task is due in ≤1 day and is blocked_by a task that is not yet done
  → "🚧 [Task] is due in ≤1 day but blocked by [Blocker], which is still '[status]'."

If no conditions apply, respond with empty text — do not send anything.
Format task references as Markdown links using the task URL.
Staleness threshold for this user: ${stalenessDays} days.
```

**`send_alert` tool**: This tool (only available in scheduled contexts) encapsulates the suppression and escalation state that was previously in `service.ts`:

```typescript
tool({
  description: 'Send an alert for a task. Handles suppression automatically.',
  inputSchema: z.object({
    taskId: z.string(),
    alertType: z.enum(['deadline_nudge', 'due_today', 'overdue', 'staleness', 'blocked']),
    message: z.string(),
  }),
  execute: async ({ taskId, alertType, message }) => {
    if (isSuppressed(userId, taskId, alertType)) return { skipped: true }
    await sendFn(userId, message)
    updateAlertState(userId, taskId, currentStatus, alertType)
    return { sent: true }
  },
})
```

The suppression logic (`isSuppressed`, `updateAlertState`) and the `alert_state` table remain — they move from `service.ts` into the `send_alert` tool implementation. The LLM no longer needs to reason about suppression at all.

**Design note on overdue escalation**: The current code reads `overdue_days_notified` from the DB to pick an escalation tier. This can remain in `send_alert` — it reads the prior notification count from `alert_state` and includes the right tier message before calling `sendFn`.

---

### 3. Reminders

**Trigger**: Per-minute reminder poller. When a reminder's `fire_at` is in the past, call `processScheduledPrompt`.

**System context**:

```
The user set a reminder that has just fired. Deliver it naturally.

Reminder text: "${reminder.text}"
${reminder.taskId
  ? `This reminder is linked to task ${reminder.taskId}. Fetch its current status
     and mention it in your message (e.g. "Reminder: review the auth PR — it is
     currently In Review").`
  : ''}

After delivering the reminder, call mark_reminder_delivered("${reminder.id}").
If the reminder has a recurrence, call advance_reminder_recurrence("${reminder.id}") as well.
Keep your message short and friendly.
```

**Prompt**: `"Deliver the reminder."`

**`mark_reminder_delivered` and `advance_reminder_recurrence` tools**: narrow tools available only in the reminder scheduled context. They wrap the existing `reminderService.markDelivered` and `reminderService.advanceRecurrence` calls.

**What the LLM does**: optionally calls `get_task(taskId)` to fetch current status, writes the reminder message, calls `mark_reminder_delivered`.

---

## What Gets Removed

| File / Function                                                                                                                                                   | Replaced by                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `src/proactive/briefing.ts` — `generate`, `generateAndRecord`, `formatFull`, `formatShort`, `buildSections`, `suggestActions`, `recordBriefingDelivery`           | LLM-generated briefing via `processScheduledPrompt`. `recordBriefingDelivery` moves into the `record_briefing_delivery` tool |
| `src/proactive/briefing.ts` — `getMissedBriefing`                                                                                                                 | Stays, but calls `processScheduledPrompt` instead of `generateAndRecord`                                                     |
| `src/proactive/service.ts` — `checkDeadlineNudge`, `checkDueToday`, `checkOverdue`, `checkStaleness`, `checkBlocked`, `runAlertCycle`, `runAlertCycleForAllUsers` | `send_alert` tool + LLM reasoning                                                                                            |
| `src/proactive/shared.ts` — `fetchAllTasks`                                                                                                                       | LLM calls `list_projects` + `list_tasks` directly                                                                            |
| `src/proactive/types.ts` — `BriefingMode`, `BriefingSection`, `BriefingTask`, `AlertCheckResult`                                                                  | No longer needed                                                                                                             |
| `src/proactive/scheduler.ts` — `fireBriefingIfDue` calling `briefingService.generateAndRecord`                                                                    | Calls `processScheduledPrompt`                                                                                               |
| `src/proactive/scheduler.ts` — `pollAlerts` calling `alertService.runAlertCycleForAllUsers`                                                                       | Calls `processScheduledPrompt` per user                                                                                      |
| `src/proactive/scheduler.ts` — `deliverReminder` calling `chatRef.sendMessage` directly                                                                           | Calls `processScheduledPrompt`                                                                                               |
| `src/llm-orchestrator.ts` — `import * as briefingService` and catch-up call in `processMessage`                                                                   | Catch-up logic stays but calls `processScheduledPrompt`                                                                      |

## What Gets Added

| Addition                                                                                      | Purpose                                                                                                                                                          |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/proactive/deferred.ts` — `processScheduledPrompt(userId, systemContext, prompt, sendFn)` | Core deferred LLM invocation, shared by all three features                                                                                                       |
| `src/proactive/deferred.ts` — `makeScheduledTools(userId, sendFn)`                            | Assembles the narrow tool set available to scheduled prompts: `send_alert`, `record_briefing_delivery`, `mark_reminder_delivered`, `advance_reminder_recurrence` |
| `src/proactive/deferred.ts` — `buildScheduledSystemPrompt(userId, context)`                   | Constructs the system prompt: date/time in user's timezone + `context` string. No conversation instructions, no task-management workflow rules                   |
| Updated `src/proactive/scheduler.ts`                                                          | `fireBriefingIfDue`, `pollAlerts`, `deliverReminder` all call `processScheduledPrompt`                                                                           |

---

## Invariants Preserved

- **`alert_state` table** stays. Suppression windows, escalation counters, `last_status_changed_at` for staleness — all still in SQLite. The `send_alert` tool reads and writes this table, so it survives across bot restarts.
- **`user_briefing_state` table** stays. The `record_briefing_delivery` tool writes to it; `getMissedBriefing` reads from it.
- **`reminders` table** stays. Reminder CRUD tools (`set_reminder`, `cancel_reminder`, etc.) are unchanged.
- **`updateAlertState` and `isSuppressed`** stay as functions, called inside the `send_alert` tool.
- **No new external dependencies.**
- **LLM config required**: if the user has not configured `llm_apikey` / `llm_baseurl` / `main_model`, scheduled prompts silently skip. This is the same behaviour as today (already gated by `checkRequiredConfig`).

---

## Implementation Tasks

### 1. Add `processScheduledPrompt` and scheduled tool set

- [ ] Create `src/proactive/deferred.ts`
- [ ] Implement `buildScheduledSystemPrompt(userId, context): string` — compact: date/time in `timezone`, no conversation rules
- [ ] Implement `makeScheduledTools(userId, sendFn): ToolSet` containing `send_alert`, `record_briefing_delivery`, `mark_reminder_delivered`, `advance_reminder_recurrence`
- [ ] Implement `processScheduledPrompt(userId, systemContext, prompt, sendFn)` — fresh context, no history, errors swallowed
- [ ] Unit tests for `processScheduledPrompt` with mocked `generateText`

### 2. Migrate briefings

- [ ] Update `fireBriefingIfDue` in `scheduler.ts`: replace `briefingService.generateAndRecord` with `processScheduledPrompt(userId, BRIEFING_SYSTEM_CONTEXT, 'Generate the morning briefing.', sendFn)`
- [ ] Update `getMissedBriefing` in `briefing.ts`: replace `generateAndRecord` call with `processScheduledPrompt` (catch-up variant); the outer detection logic stays
- [ ] Implement `record_briefing_delivery` tool inside `makeScheduledTools`
- [ ] Delete `generate`, `generateAndRecord`, `buildSections`, `suggestActions`, `formatFull`, `formatShort`, `recordBriefingDelivery` from `briefing.ts`
- [ ] Update briefing-related tests

### 3. Migrate alerts

- [ ] Update `pollAlerts` in `scheduler.ts`: replace `runAlertCycleForAllUsers` with a loop that calls `processScheduledPrompt(userId, alertSystemContext, 'Check for alerts.', sendFn)` per eligible user
- [ ] Implement `send_alert` tool inside `makeScheduledTools` (wraps `isSuppressed` + `sendFn` + `updateAlertState`)
- [ ] Delete `checkDeadlineNudge`, `checkDueToday`, `checkOverdue`, `checkStaleness`, `checkBlocked`, `runAlertCycle`, `runAlertCycleForAllUsers` from `service.ts`
- [ ] Keep `isSuppressed`, `updateAlertState`, `insertNewAlertState` in `service.ts` (used by the `send_alert` tool)
- [ ] Delete `fetchAllTasks` from `shared.ts` (or keep if still used elsewhere); delete `src/proactive/shared.ts` if empty
- [ ] Update alert-related tests

### 4. Migrate reminders

- [ ] Update `deliverReminder` in `scheduler.ts`: replace direct `sendMessage` with `processScheduledPrompt(userId, reminderSystemContext(reminder), 'Deliver the reminder.', sendFn)`
- [ ] Implement `mark_reminder_delivered` and `advance_reminder_recurrence` tools inside `makeScheduledTools`
- [ ] Update reminder delivery tests

### 5. Clean up types

- [ ] Remove `BriefingMode`, `BriefingSection`, `BriefingTask`, `AlertCheckResult` from `src/proactive/types.ts`
- [ ] Remove `import * as briefingService` from `src/llm-orchestrator.ts` if no longer needed

### 6. System prompt for scheduled context

The scheduled system prompt is intentionally minimal — no task workflow instructions, no ambiguity resolution rules, no output rules about formatting. Just:

```
You are papai, a personal task assistant acting on an automated schedule.
Current date and time: ${localDate} (${timezone}).

${systemContext}
```

Task names should still be formatted as Markdown links; include that rule in each `systemContext` string.
