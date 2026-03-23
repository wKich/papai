# Deferred LLM Prompts for Proactive Features

**Created**: 2026-03-23
**Status**: Proposed

---

## Problem

Briefings, alerts, and reminders are currently implemented as code-driven pipelines that bypass the LLM entirely:

- **Briefings**: Scheduler fires → `fetchAllTasks()` → hardcoded markdown template → `sendMessage()`
- **Alerts**: Hourly poller → `checkDeadlineNudge()` / `checkOverdue()` / `checkStaleness()` / `checkBlocked()` → hardcoded strings → `sendMessage()`
- **Reminders**: Timer fires → `sendMessage('🔔 Reminder: ' + text)`

The messages are rigid templates that cannot adapt to context or take initiative beyond what the hardcoded logic prescribes.

---

## Core Insight: Briefings Are Just Reminders

A briefing is a recurring reminder whose prompt is "generate my morning briefing." At the
execution level they are identical: a scheduled time arrives, a prompt is sent to the LLM,
the LLM response is delivered to the user. The only differences are the prompt text and the
recurrence pattern.

This means a single unified concept — **scheduled prompts** — covers both:

|              | Reminder                                | Briefing                         |
| ------------ | --------------------------------------- | -------------------------------- |
| Stored in    | `reminders` table                       | `reminders` table                |
| `text`       | `"Review the PR"`                       | `"Generate my morning briefing"` |
| `recurrence` | null or cron                            | `"0 9 * * *"` (daily 9am)        |
| User tool    | `set_reminder`                          | `set_reminder`                   |
| Manage via   | `cancel_reminder`, `snooze_reminder`, … | same tools                       |

`configure_briefing("09:00")` is replaced by `set_reminder` with text
`"Generate my morning briefing"` and recurrence `"0 9 * * *"`. No separate config key
(`briefing_time`), no separate table (`user_briefing_state`), no separate scheduler path.

**Alerts remain a separate concept.** They are not user-scheduled — they are system-initiated
responses to task state changes. The user opts into a monitoring behaviour; the system decides
when to fire based on what it finds in the task tracker. That is a different abstraction from
"run this prompt at this time."

---

## Decision

1. **Unify reminders and briefings** into a single `reminders` table and a single scheduler
   poller. A briefing is stored and managed identically to any other recurring reminder.

2. **Replace all code-driven pipelines with deferred LLM prompts**: when a scheduled prompt
   fires, the scheduler calls the LLM with the reminder text as the prompt, gives it full
   tool access, and delivers whatever the LLM produces to the user.

3. **Remove the catch-up briefing mechanic.** It existed because briefings were not
   independently fired — they depended on the user sending a message. With a proper
   per-minute poller, a missed briefing fires the moment the bot is running. No catch-up
   needed.

4. **Keep alerts as a separate system** (hourly poller + `send_alert` tool) because they
   are not prompt-based — they are state-monitoring-based.

The existing `processMessage` path is unchanged. Scheduled prompt invocations are entirely
parallel to user conversations: fresh context, no history, errors swallowed.

---

## New Entry Point: `processScheduledPrompt`

A new function in `src/proactive/deferred.ts`:

```typescript
export async function processScheduledPrompt(
  userId: string,
  prompt: string,
  sendFn: (userId: string, message: string) => Promise<void>,
): Promise<void>
```

Behaviour:

1. Checks required config (LLM key, base URL, model, task provider key). Silently returns if
   missing — no message sent for a misconfigured scheduled event.
2. Builds the LLM client and task provider for `userId`.
3. Assembles tools: full task tools (`makeTools`) + scheduled-only tools (`send_alert`,
   `mark_reminder_delivered`, `advance_reminder_recurrence`). No reminder management tools —
   scheduled prompts cannot create new reminders for themselves.
4. Calls `generateText` with:
   - `system`: minimal base prompt — current date/time in user's timezone, plus instructions
     to format task references as Markdown links and respond concisely
   - `messages`: a single `user` message containing `prompt`
   - No prior conversation history
5. If the LLM produces non-empty text, calls `sendFn(userId, text)`.
6. If the LLM produces empty text (it decided nothing is worth saying), does nothing.
7. Does **not** append to conversation history. Does **not** run `runTrimInBackground`.
8. Errors are caught, logged, and swallowed.

---

## Feature Design

### 1. Reminders and Briefings (unified)

**Trigger**: The existing per-minute reminder poller. When `fire_at` is in the past for a
`pending` reminder, call `processScheduledPrompt(userId, reminder.text, sendFn)`.

The LLM receives `reminder.text` as its prompt and full tool access. What it does depends
entirely on the text:

- `"Review the PR for task #42"` → optionally calls `get_task("42")` for current status,
  then writes a natural reminder message
- `"Generate my morning briefing"` → calls `list_projects`, `list_tasks` per project,
  writes a structured briefing
- `"Prepare standup notes"` → fetches in-progress tasks, writes a brief standup summary
- `"What did I accomplish this week?"` → fetches recently closed tasks, writes a summary

After generating the response, the LLM calls `mark_reminder_delivered(reminderId)`. If the
reminder has a recurrence, it also calls `advance_reminder_recurrence(reminderId)`.

**User experience — setting up a briefing:**

```
User: "Send me a morning briefing every day at 9am"
LLM:  calls set_reminder({
        text: "Generate my morning briefing",
        fireAt: "<next 9am ISO timestamp>",
        recurrence: "0 9 * * *"
      })
LLM:  "Done! I'll send you a morning briefing every day at 9am."
```

The user can then cancel, snooze, or reschedule it with the same natural language they'd use
for any reminder.

**System context prepended to the scheduled system prompt** (for all reminder/briefing
invocations):

```
You are papai acting on a scheduled prompt. The user is not present — do not ask
questions. Act on the prompt directly using your tools, then deliver a response.
Format task references as Markdown links using the task URL. Be concise.
```

---

### 2. Deadline and Staleness Alerts

**Trigger**: Global hourly poller — for each user with `deadline_nudges = 'enabled'`, calls
`processScheduledPrompt` with a fixed alert-check prompt.

**Prompt** sent to the LLM:

```
Check all tasks across all projects for actionable alerts. For each non-terminal task,
detect the following conditions and call send_alert for each one found:

- DEADLINE_NUDGE: due tomorrow → "📅 [Task] is due tomorrow. Make sure it's on track."
- DUE_TODAY: due today → "⏰ [Task] is due today."
- OVERDUE: past due date → escalate by days overdue:
    1–2 days: "⚠️ [Task] is N day(s) overdue. Please update its status."
    3–5 days: "🔴 [Task] is N days overdue. Please resolve or escalate."
    6+ days:  "🚨 [Task] is now N days overdue. Immediate action required."
- STALENESS: same status for more than ${stalenessDays} days →
    "🕸️ [Task] has been in '[status]' for N days with no activity."
- BLOCKED: due in ≤1 day and blocked_by an unresolved task →
    "🚧 [Task] is due in ≤1 day but blocked by [Blocker] ('[status]')."

send_alert handles suppression automatically — call it for every condition detected; it
silently skips anything alerted recently. If nothing applies, respond with empty text.
Staleness threshold: ${stalenessDays} days.
```

**`send_alert` tool** (available in scheduled contexts only):

```typescript
tool({
  description: 'Send an alert for a task. Handles deduplication and suppression automatically.',
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

The suppression logic (`isSuppressed`, `updateAlertState`) and the `alert_state` table remain
unchanged — they move from `service.ts` into the `send_alert` tool. The LLM never reasons
about suppression. Overdue escalation tier selection also moves into `send_alert` (reads
`overdue_days_notified` from `alert_state`).

---

## What Gets Removed (Future Work)

> **Note:** The items below describe the _target end state_ after this design is fully
> implemented. They are **not** removed in the current PR — they exist in the codebase today
> and will be phased out in a follow-up PR once the deferred-LLM architecture is in place.

| Removed                                                                                                                                                           | Replaced by                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `src/proactive/briefing.ts` — entire file                                                                                                                         | Briefings become recurring reminders              |
| `src/proactive/service.ts` — `checkDeadlineNudge`, `checkDueToday`, `checkOverdue`, `checkStaleness`, `checkBlocked`, `runAlertCycle`, `runAlertCycleForAllUsers` | `send_alert` tool + LLM reasoning                 |
| `src/proactive/shared.ts` — `fetchAllTasks`                                                                                                                       | LLM calls `list_projects` + `list_tasks` directly |
| `src/proactive/types.ts` — `BriefingSection`, `BriefingTask`, `AlertCheckResult`                                                                                  | No longer needed                                  |
| `src/proactive/scheduler.ts` — `fireBriefingIfDue`, `registerBriefingJob`, `unregisterBriefingJob`, `cronFromTime`, per-user briefing job map                     | Unified reminder poller handles everything        |
| `src/proactive/scheduler.ts` — `deliverReminder` direct `sendMessage` call                                                                                        | Replaced by `processScheduledPrompt`              |
| `src/proactive/scheduler.ts` — `pollAlerts` calling `runAlertCycleForAllUsers`                                                                                    | Calls `processScheduledPrompt` per eligible user  |
| `src/proactive/tools.ts` — `configure_briefing` tool                                                                                                              | `set_reminder` with briefing text + recurrence    |
| `src/types/config.ts` — `briefing_time` internal config key                                                                                                       | Stored as a `reminders` row                       |
| `src/llm-orchestrator.ts` — `import * as briefingService`, `getMissedBriefing` catch-up hook                                                                      | Removed entirely                                  |
| `user_briefing_state` DB table (migration needed)                                                                                                                 | Delivery state lives in `reminders.status`        |

## What Gets Added

| Added                                                                          | Purpose                                                                                                        |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `src/proactive/deferred.ts` — `processScheduledPrompt(userId, prompt, sendFn)` | Core deferred LLM invocation for reminders, briefings, and alerts                                              |
| `src/proactive/deferred.ts` — `makeScheduledTools(userId, sendFn)`             | Narrow tool set for scheduled contexts: `send_alert`, `mark_reminder_delivered`, `advance_reminder_recurrence` |
| `src/proactive/deferred.ts` — `SCHEDULED_SYSTEM_PROMPT`                        | Minimal system prompt for all scheduled invocations                                                            |
| Updated `src/proactive/scheduler.ts` — unified reminder poller                 | Single `pollReminders` loop calls `processScheduledPrompt` for every due reminder (including briefings)        |
| Updated `src/proactive/scheduler.ts` — alert poller                            | Calls `processScheduledPrompt` per eligible user with the alert-check prompt                                   |

---

## Invariants Preserved

- **`reminders` table** stores everything: one-time reminders, recurring reminders, and
  briefings. `set_reminder`, `cancel_reminder`, `snooze_reminder`, `reschedule_reminder`,
  `list_reminders` work for all of them.
- **`alert_state` table** stays unchanged. `isSuppressed` and `updateAlertState` stay as
  functions, called inside `send_alert`.
- **No new external dependencies.**
- **LLM config required**: misconfigured users are silently skipped.

---

## Implementation Tasks

### 1. Core: `processScheduledPrompt`

- [ ] Create `src/proactive/deferred.ts`
- [ ] Implement `SCHEDULED_SYSTEM_PROMPT` constant
- [ ] Implement `makeScheduledTools(userId, sendFn): ToolSet` — `send_alert`,
      `mark_reminder_delivered`, `advance_reminder_recurrence`
- [ ] Implement `processScheduledPrompt(userId, prompt, sendFn)` — fresh context, no history,
      errors swallowed
- [ ] Unit tests for `processScheduledPrompt` with mocked `generateText`

### 2. Unify reminder poller

- [ ] Update `deliverReminder` in `scheduler.ts` to call `processScheduledPrompt(userId,
reminder.text, sendFn)` instead of `chatRef.sendMessage`
- [ ] Implement `mark_reminder_delivered` and `advance_reminder_recurrence` tools in
      `makeScheduledTools`
- [ ] Update reminder delivery tests

### 3. Remove briefing system

- [ ] Delete `src/proactive/briefing.ts`
- [ ] Remove `registerBriefingJob`, `unregisterBriefingJob`, `fireBriefingIfDue`,
      `cronFromTime`, briefing job map from `scheduler.ts`
- [ ] Remove `configure_briefing` tool from `tools.ts`
- [ ] Remove `briefing_time` from `InternalConfigKey` in `src/types/config.ts`
- [ ] Remove `getMissedBriefing` catch-up hook from `src/llm-orchestrator.ts`
- [ ] Write and register DB migration to drop `user_briefing_state` table
- [ ] Delete briefing tests; update scheduler tests

### 4. Migrate alerts

- [ ] Update `pollAlerts` in `scheduler.ts` to call `processScheduledPrompt` per eligible
      user with the alert-check prompt
- [ ] Implement `send_alert` tool in `makeScheduledTools` (move suppression + escalation
      logic from `service.ts`)
- [ ] Delete `checkDeadlineNudge`, `checkDueToday`, `checkOverdue`, `checkStaleness`,
      `checkBlocked`, `runAlertCycle`, `runAlertCycleForAllUsers` from `service.ts`
- [ ] Keep `isSuppressed`, `updateAlertState`, `insertNewAlertState` in `service.ts`
- [ ] Delete `fetchAllTasks` from `shared.ts`; delete `shared.ts` if empty
- [ ] Update alert tests

### 5. Clean up types and imports

- [ ] Remove `BriefingSection`, `BriefingTask`, `AlertCheckResult` from `types.ts`
- [ ] Remove `import * as briefingService` from `llm-orchestrator.ts`
- [ ] Remove `briefing_time` from `InternalConfigKey`; update `CONFIG_KEYS` length test
