# Implementation Plan: Deferred LLM Prompts for Proactive Features

**Design doc**: `docs/plans/2026-03-23-deferred-llm-proactive.md`
**Date**: 2026-03-23

---

## Current State Summary

The proactive subsystem (`src/proactive/`) currently has three separate pipelines:

1. **Briefings** (`briefing.ts`) — hardcoded markdown template pipeline; scheduled via per-user cron jobs in `scheduler.ts`; catch-up logic in `llm-orchestrator.ts`; delivery state tracked in `user_briefing_state` DB table; configured via `configure_briefing` tool + `briefing_time` internal config key.

2. **Alerts** (`service.ts`) — hourly poller runs `runAlertCycleForAllUsers` → per-task check functions (`checkDeadlineNudge`, `checkDueToday`, `checkOverdue`, `checkStaleness`, `checkBlocked`) → hardcoded strings → `sendMessage`. Suppression via `alert_state` table + `isSuppressed`/`updateAlertState`.

3. **Reminders** (`reminders.ts`) — per-minute poller in `scheduler.ts` calls `fetchDue` → `deliverReminder` sends `🔔 Reminder: ${text}` directly via `chatRef.sendMessage`, then marks delivered / advances recurrence.

All three bypass the LLM entirely — messages are rigid templates.

### Key files involved:
| File | Role |
|------|------|
| `src/proactive/scheduler.ts` | Manages pollers (reminders every 1m, alerts every 1h) and per-user briefing cron jobs |
| `src/proactive/briefing.ts` | Hardcoded briefing generation, catch-up detection, `user_briefing_state` writes |
| `src/proactive/service.ts` | Alert check functions, suppression logic, `runAlertCycle` |
| `src/proactive/shared.ts` | `fetchAllTasks`, `isTerminalStatus` |
| `src/proactive/tools.ts` | `makeProactiveTools` — user-facing tools (set_reminder, configure_briefing, etc.) |
| `src/proactive/types.ts` | `AlertType`, `BriefingSection`, `BriefingTask`, `AlertCheckResult`, `CreateReminderParams`, `ReminderStatus` |
| `src/proactive/reminders.ts` | Reminder CRUD (create, list, cancel, snooze, reschedule, fetchDue, markDelivered, advanceRecurrence) |
| `src/proactive/index.ts` | Re-exports all proactive modules |
| `src/llm-orchestrator.ts` | `import * as briefingService`, `getMissedBriefing` catch-up hook in `processMessage` |
| `src/tools/index.ts` | `makeTools` — assembles all tools including proactive tools via `makeProactiveTools` |
| `src/types/config.ts` | `InternalConfigKey` includes `briefing_time` |
| `src/db/schema.ts` | `userBriefingState` table, `alertState` table, `reminders` table |
| `src/config.ts` | `getConfig`/`setConfig` for per-user config |

### Test files:
| File | Coverage |
|------|----------|
| `tests/proactive/briefing.test.ts` | Briefing generation, sections, formatting |
| `tests/proactive/scheduler.test.ts` | Poller lifecycle, briefing job registration, reminder delivery |
| `tests/proactive/service.test.ts` | Alert checks, suppression, alert cycle |
| `tests/proactive/tools.test.ts` | Proactive tool execution |
| `tests/proactive/reminders.test.ts` | Reminder CRUD operations |

---

## Implementation Phases

### Phase 1: Core — `processScheduledPrompt` (new file, no deletions)

**Goal**: Create the deferred LLM invocation function and scheduled-only tools. No existing code is modified or deleted yet.

**Files to create:**
- `src/proactive/deferred.ts`

**Files to modify:**
- None

**Tasks:**

1. **Create `src/proactive/deferred.ts`** with:
   - `SCHEDULED_SYSTEM_PROMPT` constant — minimal system prompt for all scheduled invocations:
     ```
     You are papai acting on a scheduled prompt. The user is not present — do not ask
     questions. Act on the prompt directly using your tools, then deliver a response.
     Format task references as Markdown links using the task URL. Be concise.
     ```
   - `makeScheduledTools(userId: string, sendFn: (userId: string, message: string) => Promise<void>): ToolSet` — returns three tools:
     - `send_alert` — accepts `{ taskId, alertType, message }`, calls `isSuppressed` to check suppression, sends via `sendFn`, calls `updateAlertState`. Returns `{ skipped: true }` or `{ sent: true }`.
     - `mark_reminder_delivered` — accepts `{ reminderId }`, calls `reminderService.markDelivered`.
     - `advance_reminder_recurrence` — accepts `{ reminderId }`, calls `reminderService.advanceRecurrence`.
   - `processScheduledPrompt(userId: string, prompt: string, sendFn: (...) => Promise<void>): Promise<void>`:
     1. Check required config (`llm_apikey`, `llm_baseurl`, `main_model`, provider key). Return silently if missing.
     2. Build LLM client via `createOpenAICompatible`.
     3. Build task provider (reuse `buildProvider` logic — extract from `llm-orchestrator.ts` or duplicate minimally).
     4. Assemble tools: `makeTools(provider, userId)` + `makeScheduledTools(userId, sendFn)`. Exclude `configure_briefing` and `configure_alerts` from the scheduled context (scheduled prompts should not self-modify schedules).
     5. Call `generateText` with `SCHEDULED_SYSTEM_PROMPT` + user timezone/date, single user message = `prompt`, no history, `stepCountIs(25)`.
     6. If non-empty text, call `sendFn(userId, text)`.
     7. Wrap everything in try/catch, log errors, swallow.

2. **Write unit tests** `tests/proactive/deferred.test.ts`:
   - Mock `generateText` (module-level mock pattern per CLAUDE.md).
   - Test: config missing → silently returns, no LLM call.
   - Test: LLM returns text → `sendFn` called with text.
   - Test: LLM returns empty text → `sendFn` not called.
   - Test: LLM error → caught and logged, `sendFn` not called.
   - Test: `send_alert` tool — suppressed → returns `{ skipped: true }`.
   - Test: `send_alert` tool — not suppressed → sends message, updates state.
   - Test: `mark_reminder_delivered` → calls `markDelivered`.
   - Test: `advance_reminder_recurrence` → calls `advanceRecurrence`.

**Why phase 1 first**: This is the foundational abstraction. Everything else depends on it. Adding it without modifying existing code means zero risk of breaking current behavior.

---

### Phase 2: Unify reminder delivery through LLM

**Goal**: Replace the direct `chatRef.sendMessage('🔔 Reminder: ...')` in `deliverReminder` with `processScheduledPrompt`, so reminders flow through the LLM.

**Files to modify:**
- `src/proactive/scheduler.ts`
- `tests/proactive/scheduler.test.ts`

**Tasks:**

1. **Update `deliverReminder` in `scheduler.ts`**:
   - Instead of `chatRef.sendMessage(reminder.userId, '🔔 **Reminder:** ${reminder.text}')` followed by `markDelivered` + `advanceRecurrence`, call:
     ```typescript
     const prompt = `Reminder ID: ${reminder.id}\n\n${reminder.text}\n\nAfter responding, call mark_reminder_delivered with reminderId "${reminder.id}".${reminder.recurrence !== null ? ` Then call advance_reminder_recurrence with reminderId "${reminder.id}".` : ''}`
     await processScheduledPrompt(reminder.userId, prompt, sendFn)
     ```
   - The LLM now handles marking delivered and advancing recurrence via the scheduled tools.
   - Remove the direct `reminderService.markDelivered` and `reminderService.advanceRecurrence` calls from `deliverReminder`.

2. **Update `pollReminders`**:
   - Extract `sendFn` from `chatRef` so it can be passed to `processScheduledPrompt`:
     ```typescript
     const sendFn = (userId: string, message: string) => chatRef!.sendMessage(userId, message)
     ```

3. **Handle fallback**: If `processScheduledPrompt` fails silently (LLM config missing), the reminder won't be marked delivered. This is correct — it will be retried on the next poll cycle. But add a fallback: if LLM config is missing, fall back to the original direct-send behavior so reminders still work for users without LLM configured.

4. **Update scheduler tests**:
   - Mock `processScheduledPrompt` instead of `chatRef.sendMessage` for reminder delivery tests.
   - Test: reminder with recurrence → prompt includes advance instruction.
   - Test: reminder without recurrence → prompt does not include advance instruction.
   - Keep existing poller lifecycle tests (start/stop).

**Why phase 2 second**: Reminders are the simplest migration — it's a 1:1 replacement of direct send with LLM prompt. The `mark_reminder_delivered` and `advance_reminder_recurrence` tools from Phase 1 are exercised here.

---

### Phase 3: Remove briefing system

**Goal**: Delete the entire briefing pipeline. Briefings become recurring reminders (users set them up via `set_reminder`).

**Files to delete:**
- `src/proactive/briefing.ts`

**Files to modify:**
- `src/proactive/scheduler.ts` — remove `registerBriefingJob`, `unregisterBriefingJob`, `fireBriefingIfDue`, `cronFromTime`, briefing job map, per-user briefing registration in `start()`. Remove `import * as briefingService`.
- `src/proactive/tools.ts` — remove `makeGetBriefingTool`, `makeConfigureBriefingTool`, `import * as briefingService`. Remove `get_briefing` and `configure_briefing` from `makeProactiveTools` return.
- `src/proactive/types.ts` — remove `BriefingSection`, `BriefingTask` types.
- `src/proactive/index.ts` — remove `export * as briefingService`.
- `src/llm-orchestrator.ts` — remove `import * as briefingService`, remove `getMissedBriefing` catch-up block from `processMessage`.
- `src/types/config.ts` — remove `briefing_time` from `InternalConfigKey`.
- `src/db/schema.ts` — keep `userBriefingState` table definition (migration will drop it, but schema stays for migration compatibility).
- Add new migration `src/db/migrations/013_drop_briefing_state.ts` to drop `user_briefing_state` table.

**Files to delete (tests):**
- `tests/proactive/briefing.test.ts`

**Files to modify (tests):**
- `tests/proactive/scheduler.test.ts` — remove briefing job tests.
- `tests/proactive/tools.test.ts` — remove `get_briefing` and `configure_briefing` tests.
- `tests/config.test.ts` — update `CONFIG_KEYS` length assertion if it checks `InternalConfigKey` count.

**Tasks:**

1. Delete `src/proactive/briefing.ts`.
2. Clean `scheduler.ts`:
   - Remove `BriefingJob` type, `briefingJobs` map, `cronFromTime`, `registerBriefingJob`, `unregisterBriefingJob`, `fireBriefingIfDue`, `_fireBriefingIfDue`, `_getBriefingJobs`, `getBriefingJobCount`.
   - Remove per-user briefing registration loop from `start()`.
   - Remove `import * as briefingService`.
3. Clean `tools.ts`:
   - Remove `makeGetBriefingTool` and `makeConfigureBriefingTool` functions.
   - Remove `get_briefing` and `configure_briefing` from `makeProactiveTools`.
   - Remove `import * as briefingService` and `import * as scheduler`.
4. Clean `types.ts`:
   - Remove `BriefingSection`, `BriefingTask` types.
5. Clean `index.ts`:
   - Remove `export * as briefingService`.
6. Clean `llm-orchestrator.ts`:
   - Remove `import * as briefingService`.
   - Remove the `getMissedBriefing` catch-up block in `processMessage`.
7. Clean `config.ts`:
   - Remove `briefing_time` from `InternalConfigKey`.
8. Write migration `013_drop_briefing_state.ts`:
   ```typescript
   export function up(db): void {
     db.run('DROP TABLE IF EXISTS user_briefing_state')
   }
   ```
9. Remove `userBriefingState` from `schema.ts` exports and table definition.
10. Delete `tests/proactive/briefing.test.ts`.
11. Update remaining tests.

**Why phase 3 third**: The briefing system is the largest piece to remove. Doing it after Phase 2 means reminders already go through the LLM, so a user setting `set_reminder({ text: "Generate my morning briefing", recurrence: "0 9 * * *" })` will naturally work — the LLM will receive that prompt and use its tools to generate a briefing.

---

### Phase 4: Migrate alerts to LLM

**Goal**: Replace the code-driven alert checking pipeline with an LLM-driven approach. The hourly poller sends an alert-check prompt to the LLM; the LLM inspects tasks and calls `send_alert` for each condition found.

**Files to modify:**
- `src/proactive/scheduler.ts` — update `pollAlerts` to call `processScheduledPrompt` per eligible user with the alert-check prompt.
- `src/proactive/service.ts` — remove `checkDeadlineNudge`, `checkDueToday`, `checkOverdue`, `checkStaleness`, `checkBlocked`, `runAlertCycle`, `runAlertCycleForAllUsers`. Keep `isSuppressed`, `updateAlertState`, `insertNewAlertState`, `SUPPRESSION_MS`.

**Files to delete:**
- `src/proactive/shared.ts` (after confirming `isTerminalStatus` is either moved or inlined into `service.ts`)

**Files to modify (tests):**
- `tests/proactive/service.test.ts` — remove tests for deleted functions; add tests for remaining suppression/state functions.
- `tests/proactive/scheduler.test.ts` — update alert poller tests.

**Tasks:**

1. **Update `pollAlerts` in `scheduler.ts`**:
   - For each user with `deadline_nudges = 'enabled'`:
     ```typescript
     const stalenessDays = getConfig(userId, 'staleness_days') ?? '7'
     const prompt = `Check all tasks across all projects for actionable alerts...` // (full prompt from design doc, with stalenessDays interpolated)
     await processScheduledPrompt(userId, prompt, sendFn)
     ```
   - Remove `import * as alertService` (or keep only for `isSuppressed`/`updateAlertState` used by `send_alert`).

2. **Move `isTerminalStatus` from `shared.ts`**:
   - Move to `service.ts` since it's used there for suppression context.
   - Or keep in `shared.ts` if other modules still import it (check `index.ts` re-exports).
   - Decision: Since `index.ts` re-exports `isTerminalStatus` from `shared.ts`, and external code may depend on it, keep `shared.ts` but remove `fetchAllTasks`. If `shared.ts` only exports `isTerminalStatus` and `TERMINAL_STATUS_SLUGS`, consider moving them to `types.ts` or `service.ts` and deleting `shared.ts`.

3. **Update `send_alert` tool in `deferred.ts`** (from Phase 1):
   - The `send_alert` tool already handles suppression via `isSuppressed` and state via `updateAlertState`.
   - Ensure overdue escalation tier logic is in `send_alert`: read `overdueDaysNotified` from `alert_state`, select emoji tier accordingly. The LLM provides the raw message; `send_alert` may adjust escalation messaging, OR the LLM prompt instructs the LLM to select the right tier. Per the design doc, the LLM selects the tier based on the prompt instructions. `send_alert` just records and suppresses.

4. **Clean `service.ts`**:
   - Remove `checkDeadlineNudge`, `checkDueToday`, `checkOverdue`, `checkStaleness`, `checkBlocked`.
   - Remove `runAlertCycle`, `runAlertCycleForAllUsers`.
   - Remove `fetchAllTasks` import from `shared.js`.
   - Remove `taskLink` helper (LLM generates its own links).
   - Remove `getTodayInTz`, `getTomorrowInTz`, `formatDateInTz` (LLM handles date reasoning).
   - Keep: `isSuppressed`, `updateAlertState`, `insertNewAlertState`, `SUPPRESSION_MS`, `generateId`.

5. **Clean `types.ts`**:
   - Remove `AlertCheckResult` type (no longer returned by anything).

6. **Update tests**.

**Why phase 4 last**: This is the most complex migration because the LLM takes over reasoning about task states. It requires Phase 1's `send_alert` tool and Phase 2's proven `processScheduledPrompt` pipeline. The alert suppression/state logic is preserved but relocated into the tool.

---

### Phase 5: Clean up types, imports, and index exports

**Goal**: Final cleanup pass to remove dead code, update re-exports, and verify everything compiles.

**Tasks:**

1. Update `src/proactive/index.ts` re-exports:
   - Remove `export * as briefingService` (done in Phase 3).
   - Add `export { processScheduledPrompt, makeScheduledTools } from './deferred.js'`.
   - Remove `export { fetchAllTasks } from './shared.js'` if `shared.ts` was deleted.
   - Keep `isTerminalStatus`, `TERMINAL_STATUS_SLUGS` exports (relocated).

2. Verify `src/proactive/types.ts` only contains types still in use:
   - `AlertType` — still used by `send_alert` tool and `isSuppressed`.
   - `CreateReminderParams` — still used by `reminders.ts`.
   - `ReminderStatus` — still used by `reminders.ts`.
   - Remove: `BriefingSection`, `BriefingTask`, `AlertCheckResult` (done in earlier phases).

3. Run full check suite: `bun check` (lint, typecheck, format:check, knip, test, security).

4. Fix any unused imports/exports flagged by `knip`.

---

## Dependency Graph

```
Phase 1: Core (deferred.ts)
    │
    ├── Phase 2: Unify reminders (scheduler.ts update)
    │
    ├── Phase 3: Remove briefings (delete briefing.ts, clean tools/scheduler/orchestrator)
    │       │
    │       └── depends on Phase 2 (reminders already LLM-driven, so briefing-as-reminder works)
    │
    └── Phase 4: Migrate alerts (update scheduler/service)
            │
            └── depends on Phase 1 (send_alert tool)

Phase 5: Cleanup
    └── depends on all above
```

Phases 2, 3, and 4 can be done in any order after Phase 1, but the recommended order (2→3→4) minimizes risk by starting with the simplest migration and ending with the most complex.

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| LLM config missing → reminders silently fail | Phase 2 adds fallback: if LLM config missing, fall back to direct send |
| LLM doesn't call `mark_reminder_delivered` → reminder re-fires every minute | Prompt explicitly instructs LLM to call the tool; `stepCountIs(25)` gives ample tool-call budget |
| Alert prompt too long for some models | Keep prompt concise; test with target models |
| `send_alert` suppression regression | Suppression logic is preserved unchanged from `service.ts`; same unit tests apply |
| Migration drops `user_briefing_state` data | Acceptable — briefing state is ephemeral (just "last delivery date") |
| Test pollution from mocking `ai` module | Follow CLAUDE.md mock patterns; use `mock.restore()` in `afterAll` |

---

## Files Changed Summary

### Created
- `src/proactive/deferred.ts`
- `src/db/migrations/013_drop_briefing_state.ts`
- `tests/proactive/deferred.test.ts`

### Deleted
- `src/proactive/briefing.ts`
- `src/proactive/shared.ts` (if `isTerminalStatus` relocated)
- `tests/proactive/briefing.test.ts`

### Modified
- `src/proactive/scheduler.ts` — remove briefing jobs, update `deliverReminder` and `pollAlerts`
- `src/proactive/service.ts` — remove check functions and `runAlertCycle*`, keep suppression
- `src/proactive/tools.ts` — remove briefing tools
- `src/proactive/types.ts` — remove briefing/alert-result types
- `src/proactive/index.ts` — update re-exports
- `src/llm-orchestrator.ts` — remove briefing import and catch-up hook
- `src/types/config.ts` — remove `briefing_time`
- `src/db/schema.ts` — remove `userBriefingState`
- `tests/proactive/scheduler.test.ts` — update for new delivery flow
- `tests/proactive/service.test.ts` — remove deleted function tests
- `tests/proactive/tools.test.ts` — remove briefing tool tests
