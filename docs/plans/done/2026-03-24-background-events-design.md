# Background Events: Deferred Prompt History Integration

**Date:** 2026-03-24
**Status:** Approved

## Problem

`poller.ts` currently logs deferred prompt executions into conversation history as fake `role: 'user'` + `role: 'assistant'` pairs via `logToHistory`. This contaminates the history with synthetic user messages the user never sent, confuses the main LLM about who said what, and causes rolling summaries to misrepresent background tasks as user-initiated conversations.

## Solution: Background Event Journal (Approach B)

Store deferred prompt executions in a separate `background_events` table. On the user's first message after background activity, inject unseen events as a system context message, append them individually to conversation history, then mark them injected. The events then live in history as `role: 'system'` messages and get absorbed into rolling summaries like any other history entry.

## Data Model

**New table: `background_events`**

| Column       | Type             | Notes                              |
| ------------ | ---------------- | ---------------------------------- |
| `id`         | TEXT PRIMARY KEY | UUID                               |
| `userId`     | TEXT NOT NULL    |                                    |
| `type`       | TEXT NOT NULL    | `'scheduled'` \| `'alert'`         |
| `prompt`     | TEXT NOT NULL    | Original instruction               |
| `response`   | TEXT NOT NULL    | LLM response, capped at 2000 chars |
| `createdAt`  | TEXT NOT NULL    | ISO timestamp                      |
| `injectedAt` | TEXT             | NULL until consumed                |

Index on `(userId, injectedAt)` for efficient unseen lookup.

Migration: `014_background_events.ts`. New Drizzle export: `backgroundEvents` + `BackgroundEventRow` type.

## Module Structure

### New: `src/deferred-prompts/background-events.ts`

- `recordBackgroundEvent(userId, type, prompt, response)` — inserts a row (response capped at 2000 chars)
- `loadUnseenEvents(userId)` — returns rows where `injectedAt IS NULL`, ordered by `createdAt ASC`
- `markEventsInjected(ids: string[])` — sets `injectedAt = now` for the given IDs
- `pruneBackgroundEvents(olderThanDays = 30)` — deletes old rows; called from `startPollers` on startup

### Changes: `poller.ts`

Remove `logToHistory`. Replace both call sites with `recordBackgroundEvent`:

- `executeScheduledPrompt`: on success → `recordBackgroundEvent(userId, 'scheduled', prompt.prompt, response)`; on failure → `recordBackgroundEvent(userId, 'scheduled', prompt.prompt, 'Failed: <error message>')` + `chat.sendMessage(userId, errorNotice)`
- `executeSingleAlert`: same pattern with `type: 'alert'`

### Changes: `llm-orchestrator.ts`

After loading history, before `generateText`:

1. Call `loadUnseenEvents(userId)`
2. If any events exist:
   a. Format as a single `role: 'system'` context message (see format below)
   b. Prepend to the messages array for this LLM call
   c. Append each event individually to conversation history as `role: 'system'`
   d. Call `markEventsInjected(ids)`

## Injection Format

Prepended system message:

```
[Background tasks completed while you were away]

[2026-03-24 09:00 UTC | scheduled] Create weekly report
→ Created task 'Weekly Report' in project Alpha.

[2026-03-24 09:05 UTC | alert] Condition: task.dueDate overdue
→ Found 2 overdue tasks in project Beta. I've added a comment to each.
```

Individual history entries appended per event:

```ts
{
  role: 'system',
  content: '[Background: scheduled | 2026-03-24T09:00:00Z]\nCreate weekly report\n→ Created task...'
}
```

## Event Lifecycle

1. Deferred prompt runs → `recordBackgroundEvent` writes row (injectedAt = NULL)
2. User sends next message → `loadUnseenEvents` returns the row → injected into LLM context + appended to history + `markEventsInjected` called
3. All future messages → event is in history as a system message; rolling summary absorbs it over time
4. After 30 days → `pruneBackgroundEvents` removes the row

## Error Handling

| Scenario                                   | Behaviour                                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| LLM/provider call fails in poller          | `recordBackgroundEvent` called with error as response; user notified via `chat.sendMessage`         |
| `markEventsInjected` fails after injection | Events re-injected on next user message (duplicate system messages); acceptable over losing context |
| No unseen events                           | No system message prepended; no history changes                                                     |

## What Does Not Change

- `Promise.allSettled` error isolation in `poller.ts` remains intact
- `buildMessagesWithMemory` / rolling summary logic in `conversation.ts` unchanged
- Alert and scheduled prompt CRUD, condition evaluation, snapshot logic — all unchanged
