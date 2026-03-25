# Deferred Prompt Execution Modes

## Problem

Every deferred prompt — whether a simple "remind me to drink water" or a complex "check overdue tasks and reassign them" — goes through the same heavy execution path: full conversation history, full system prompt, task provider instantiation, all capability-gated tools, and up to 25 tool-use steps. This is expensive and unnecessary for simple prompts.

## Decision

Introduce three execution modes that control what resources are loaded at fire time. The creating LLM classifies each prompt at creation time and enriches it with a delivery brief and optional context snapshot.

## Execution Modes

|                  | Lightweight                   | Context      | Full                       |
| ---------------- | ----------------------------- | ------------ | -------------------------- |
| Model            | `small_model` -> `main_model` | `main_model` | `main_model`               |
| System prompt    | minimal                       | minimal      | full (`buildSystemPrompt`) |
| History          | no                            | yes          | yes                        |
| Context snapshot | if present                    | if present   | if present                 |
| Delivery brief   | yes                           | yes          | yes                        |
| Tools            | no                            | no           | yes (capability-gated)     |
| Provider         | no                            | no           | yes                        |
| Fact extraction  | no                            | no           | yes                        |
| History append   | yes                           | yes          | yes                        |

**Lightweight** — simple reminders, facts, nudges. No task tracker data or conversation context needed at fire time.

**Context** — lightweight plus history. Requires understanding of conversation flow but no live data lookup.

**Full** — requires live task tracker operations (search, create, update, check status) at fire time. Current behavior.

## Data Model

### New `execution_metadata` JSON column

Added to both `scheduled_prompts` and `alert_prompts` tables. The `prompt` column stays as-is (raw user text for display).

```typescript
type ExecutionMetadata = {
  mode: 'lightweight' | 'context' | 'full'
  delivery_brief: string
  context_snapshot: string | null
}
```

Column definition: `execution_metadata TEXT NOT NULL DEFAULT '{}'`

Default `{}` handles backward compatibility — existing rows without metadata are treated as `full` mode.

### Domain types

`ScheduledPrompt` and `AlertPrompt` gain:

```typescript
executionMetadata: ExecutionMetadata
```

Parsed from JSON on read, serialized on write — same pattern as `alert_prompts.condition`.

## Creation-Time Enrichment

### Tool schema change

The `create_deferred_prompt` and `update_deferred_prompt` tools gain a nested `execution` parameter:

```typescript
execution: z.object({
  mode: z.enum(['lightweight', 'context', 'full']),
  delivery_brief: z.string(),
  context_snapshot: z.string().optional(),
})
```

On `create`: optional with default `{ mode: 'full', delivery_brief: '', context_snapshot: null }` for backward compatibility.
On `update`: optional — allows changing execution metadata of existing prompts.

### LLM classification guidance (in tool description)

- `lightweight` — simple reminders, facts, nudges. No task tracker data or conversation context needed at fire time.
- `context` — requires understanding of what was discussed but no live data lookup. The creating LLM captures relevant context now.
- `full` — requires live task tracker operations at fire time.

### Delivery brief

Freeform natural language instructions for the executing LLM. Should describe intent, tone, key details, and any specific entities to reference. Universal across all three modes.

**Alternative (noted):** A structured format with explicit fields for intent, tone, and key details could be used instead. Worth revisiting if freeform briefs prove inconsistent.

### Context snapshot

When the user references something from the current conversation, the creating LLM distills only the relevant parts into a summary — not a raw copy of messages. `null` when the prompt is self-contained. Orthogonal to execution mode — any mode can have it or not.

### Example payloads

**"at 3pm remind me to drink water":**

```json
{
  "prompt": "remind me to drink water",
  "schedule": { "fire_at": { "date": "2026-03-26", "time": "15:00" } },
  "execution": {
    "mode": "lightweight",
    "delivery_brief": "Simple hydration reminder. Deliver as a friendly, casual nudge.",
    "context_snapshot": null
  }
}
```

**"in 2 hours remind me about the migration we discussed":**

```json
{
  "prompt": "remind me about the migration we discussed",
  "schedule": { "fire_at": { "date": "2026-03-26", "time": "17:30" } },
  "execution": {
    "mode": "lightweight",
    "delivery_brief": "Remind user about the users table migration from Postgres to the new schema using Drizzle. They were concerned about downtime. Warm, collegial tone.",
    "context_snapshot": "User discussed migrating the users table to a new schema. Using Drizzle for the migration. Main concern: minimizing downtime. Considered running dual-write for a transition period."
  }
}
```

**"every morning at 9am check my overdue tasks and summarize them":**

```json
{
  "prompt": "check my overdue tasks and summarize them",
  "schedule": { "cron": "0 9 * * *" },
  "execution": {
    "mode": "full",
    "delivery_brief": "Search for overdue tasks across all projects. Summarize grouped by project. Casual morning briefing tone — like a helpful colleague giving a quick heads-up.",
    "context_snapshot": null
  }
}
```

## Execution-Time Dispatch

### Three execution functions

The poller reads `execution_metadata.mode` and dispatches to the corresponding function.

**`invokeLightweight(userId, prompt, metadata)`**

- Model: `small_model` with `main_model` fallback
- System prompt: minimal (current time/timezone + delivery instructions)
- Messages: delivery brief as system message, prompt wrapped in `===DEFERRED_TASK===` delimiters as user message. Context snapshot injected as system message if present.
- No tools, no provider, no history
- Appends assistant response to history. No fact extraction.

**`invokeWithContext(userId, prompt, metadata)`**

- Model: `main_model`
- System prompt: minimal (same as lightweight)
- Messages: full history via `buildMessagesWithMemory`, then delivery brief as system message, prompt as user message. Context snapshot if present.
- No tools, no provider
- Appends assistant response to history. Triggers trim check. No fact extraction.

**`invokeFull(userId, prompt, metadata, buildProviderFn)`**

- Current `invokeLlmWithHistory` with the addition of delivery brief and context snapshot
- Model: `main_model`
- System prompt: full `buildSystemPrompt`
- Messages: full history + memory + delivery brief + prompt + context snapshot
- Full tool set (capability-gated, minus deferred tools)
- Appends assistant response to history. Triggers trim check. Extracts facts.

### Dispatcher

```typescript
function dispatchExecution(mode: ExecutionMode, ...): Promise<string> {
  switch (mode) {
    case 'lightweight': return invokeLightweight(...)
    case 'context':     return invokeWithContext(...)
    case 'full':        return invokeFull(...)
  }
}
```

Falls back to `full` when execution metadata is empty or mode is missing.

### Minimal system prompt

Shared by lightweight and context modes:

```
[PROACTIVE EXECUTION]
Current time: {localTime} ({timezone})
Trigger type: {scheduled|alert}

A deferred prompt has fired. Deliver the result warmly and conversationally.
Do not mention scheduling, triggers, or system events.
Do not create new deferred prompts.
```

## Message Construction

### Injection pattern

**Lightweight:**

```typescript
const messages: ModelMessage[] = [
  { role: 'system', content: minimalSystemPrompt },
  { role: 'system', content: `[DELIVERY BRIEF]\n${metadata.delivery_brief}` },
  // only if context_snapshot is non-null:
  { role: 'system', content: `[CONTEXT FROM CREATION TIME]\n${metadata.context_snapshot}` },
  { role: 'user', content: '===DEFERRED_TASK===\n{prompt}\n===END_DEFERRED_TASK===' },
]
```

**Context:**

```typescript
const messages: ModelMessage[] = [
  ...buildMessagesWithMemory(userId, history).messages,
  { role: 'system', content: minimalSystemPrompt },
  { role: 'system', content: `[DELIVERY BRIEF]\n${metadata.delivery_brief}` },
  // only if context_snapshot is non-null:
  { role: 'system', content: `[CONTEXT FROM CREATION TIME]\n${metadata.context_snapshot}` },
  { role: 'user', content: '===DEFERRED_TASK===\n{prompt}\n===END_DEFERRED_TASK===' },
]
```

**Full:**

```typescript
const messages: ModelMessage[] = [
  ...buildMessagesWithMemory(userId, history).messages,
  { role: 'system', content: fullProactiveTrigger.systemContext },
  { role: 'system', content: `[DELIVERY BRIEF]\n${metadata.delivery_brief}` },
  // only if context_snapshot is non-null:
  { role: 'system', content: `[CONTEXT FROM CREATION TIME]\n${metadata.context_snapshot}` },
  { role: 'user', content: fullProactiveTrigger.userContent },
]
```

### Key principles

- Delivery brief is always a system message (LLM-authored instructions, system priority).
- Context snapshot is a system message (LLM-authored summary, system priority).
- Original prompt stays as a user message (avoids elevating untrusted user text).
- Context snapshot messages omitted when null.
- Labeled with bracketed headers for LLM disambiguation.

## Testing

### New test file: `tests/deferred-prompts/execution-modes.test.ts`

- **`invokeLightweight`**: uses `small_model` (falls back to `main_model`), minimal system prompt, no history/tools/provider, appends response to history.
- **`invokeWithContext`**: uses `main_model`, loads history, minimal system prompt, no tools/provider, appends response, triggers trim.
- **`invokeFull`**: loads history, full system prompt, tools, provider, extracts facts, appends response, triggers trim.
- **Common**: delivery brief injected, context snapshot when present, prompt wrapped in delimiters, assistant response persisted.
- **Dispatcher**: routes by mode, falls back to full for missing metadata.
- **Message construction**: correct ordering, labels, snapshot omission when null.

### Existing test updates

- Tool tests: cover `execution` parameter on create/update, validation of mode enum, required delivery_brief, optional context_snapshot.
- Migration test: verify new column exists, default value works, existing rows fall back to full mode.

### Mocking

Module-level mocking with mutable function references, `mock.restore()` in `afterAll`. Follows project conventions.

## Migration & Backward Compatibility

### Migration

```sql
ALTER TABLE scheduled_prompts ADD COLUMN execution_metadata TEXT NOT NULL DEFAULT '{}';
ALTER TABLE alert_prompts ADD COLUMN execution_metadata TEXT NOT NULL DEFAULT '{}';
```

### Backward compatibility

- Existing rows: empty `{}` parsed at read time, dispatcher treats missing mode as `full`.
- Older tool calls without `execution` field: parameter is optional with default `{ mode: 'full', delivery_brief: '', context_snapshot: null }`.
- Domain type mappers default to full mode on parse failure.

### Rollback

Column addition is non-destructive. Ignored by older code if rolled back.

## Files Changed

### New files

- `src/db/migrations/XXXX-add-execution-metadata.ts`
- `tests/deferred-prompts/execution-modes.test.ts`

### Modified files

| File                                    | Change                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| `src/db/schema.ts`                      | Add `executionMetadata` column to both tables                                   |
| `src/deferred-prompts/types.ts`         | Add `ExecutionMetadata` type, add field to `ScheduledPrompt` and `AlertPrompt`  |
| `src/deferred-prompts/tools.ts`         | Add `execution` parameter to create/update schemas with classification guidance |
| `src/deferred-prompts/proactive-llm.ts` | Three execution functions, dispatcher, minimal system prompt builder            |
| `src/deferred-prompts/scheduled.ts`     | Pass through `executionMetadata` in create/update/read                          |
| `src/deferred-prompts/alerts.ts`        | Pass through `executionMetadata` in create/update/read                          |
| `src/deferred-prompts/poller.ts`        | Read mode from metadata, call dispatcher                                        |

### Unchanged

- `src/deferred-prompts/fetch-tasks.ts` — only used by full mode
- `src/deferred-prompts/snapshots.ts` — only used by alert polling
- `src/tools/index.ts` — tool mode gating unchanged
- `src/system-prompt.ts` — full system prompt unchanged
- `src/conversation.ts` — used by context and full modes as-is
