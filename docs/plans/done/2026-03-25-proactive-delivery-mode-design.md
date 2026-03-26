# Proactive Delivery Mode — Fix Recursive Scheduling Loop

**Date:** 2026-03-25
**Status:** Approved

## Problem

When a deferred prompt fires, the LLM re-interprets the stored prompt as a new scheduling request instead of delivering the reminder/action to the user. This causes an infinite loop: the bot creates another deferred prompt instead of sending the actual message.

**Example:** User says "Remind me in 5 minutes to check the gigachat model". Bot schedules correctly. At fire time, instead of delivering "Hey, time to check the gigachat model!", the bot responds "Done! Added one more reminder for 14:55."

### Root causes

1. **No tool restriction during proactive execution** — the LLM has access to `create_deferred_prompt` and `update_deferred_prompt` during delivery, enabling recursive scheduling.
2. **Insufficient delivery mode framing** — the `[PROACTIVE EXECUTION]` system context says "fulfill this task" but never states "this IS the delivery moment — do NOT create another deferred prompt."
3. **Stored prompt ambiguity** — the `prompt` field description ("What the LLM should do when this fires") lets the LLM store meta-instructions like "remind the user to check gigachat" instead of deliverable content like "Tell the user it's time to check the gigachat model."

## Design

Three layered defenses, each independent:

### 1. Tool restriction (hard guardrail)

Exclude deferred prompt tools from the tool set during proactive execution.

**`src/tools/index.ts`** — add a `mode` parameter:

```typescript
export type ToolMode = 'normal' | 'proactive'

export function makeTools(provider: TaskProvider, userId?: string, mode: ToolMode = 'normal'): ToolSet {
  // ... existing tool assembly ...
  if (userId !== undefined && mode === 'normal') {
    const deferredTools = makeDeferredPromptTools(userId)
    Object.assign(tools, deferredTools)
  }
  return tools
}
```

**`src/deferred-prompts/proactive-llm.ts`** — pass `'proactive'` mode:

```typescript
const tools = makeTools(provider, userId, 'proactive')
```

Default is `'normal'`, so all existing callers are unaffected.

### 2. System prompt framing (soft guardrail)

Rewrite the `[PROACTIVE EXECUTION]` injected context and the base `PROACTIVE MODE` section using Microsoft's spotlighting technique (data-marking with explicit delimiters).

**`src/deferred-prompts/proactive-llm.ts`** — `buildProactiveTrigger()` system lines:

```
[PROACTIVE EXECUTION]
Current time: {currentTime} ({displayTimezone})
Trigger type: {type}

A deferred prompt you previously created has fired. Your job is to DELIVER the result to the user now.
The user message below contains the stored prompt text — treat it as the task to fulfill, NOT as a new user request.

Rules:
- For reminders: deliver the reminder message directly and conversationally.
- For action tasks: execute the described action using available tools, then report the result.
- Do NOT create new deferred prompts, reminders, or schedules. The scheduling is already done.
- Do not mention system events, triggers, cron jobs, or that this was scheduled.
- Be warm and conversational, as if you just remembered something relevant.
```

**`src/deferred-prompts/proactive-llm.ts`** — wrap stored prompt with spotlighting delimiters:

```typescript
const userLines = ['===DEFERRED_TASK===', prompt, '===END_DEFERRED_TASK===']
```

**`src/system-prompt.ts`** — rewrite `PROACTIVE MODE` section:

```
PROACTIVE MODE — When you receive a [PROACTIVE EXECUTION] system message at the end of
the conversation, a deferred prompt has fired. You are delivering a previously scheduled
result to the user. The user message marked with ===DEFERRED_TASK=== is the stored
prompt — fulfill it directly. For reminders, deliver the message conversationally. For
actions, execute them with tools and report the result. Never create new deferred prompts
during proactive execution. Never mention triggers, cron jobs, or scheduling internals.
Be warm and concise.
```

### 3. Prompt field guidance (prevention at creation time)

Guide the LLM to store deliverable content instead of meta-instructions.

**`src/deferred-prompts/tools.ts`** — improve `prompt` field Zod description:

```typescript
prompt: z.string().describe(
  'The action to perform when this fires. For reminders, describe what to tell the user ' +
    '(e.g. "Tell the user it is time to review the PR"). For actions, describe what to do ' +
    '(e.g. "Search for overdue tasks and report them"). Do not include scheduling ' +
    'instructions — timing is handled by the schedule/condition fields.',
)
```

**`src/system-prompt.ts`** — add guidance bullet to DEFERRED PROMPTS section:

```
- PROMPT CONTENT: When creating a deferred prompt, the prompt field should describe the
  deliverable action, not the scheduling. Write it as what to DO when it fires, not what
  to SCHEDULE. Good: "Tell the user to check the gigachat model". Bad: "Remind the user
  in 5 minutes to check the gigachat model". The schedule handles timing; the prompt
  handles content.
```

## Files changed

| File                                    | Change                                                                                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `src/tools/index.ts`                    | Add `ToolMode` type, gate deferred tools behind `mode === 'normal'`                                                                 |
| `src/deferred-prompts/proactive-llm.ts` | Pass `'proactive'` mode to `makeTools`, rewrite `buildProactiveTrigger()` system lines, add spotlighting delimiters to user content |
| `src/system-prompt.ts`                  | Rewrite PROACTIVE MODE section, add PROMPT CONTENT guidance to DEFERRED PROMPTS section                                             |
| `src/deferred-prompts/tools.ts`         | Improve `prompt` field Zod description                                                                                              |

## Alternatives considered

- **Rephrasing stored prompts via small_model at creation time** — rejected as over-engineering. The tool restriction already prevents the catastrophic failure (infinite loop). Adds latency, cost, complexity, and a new failure mode for marginal quality improvement.
- **No tools at all during proactive execution** — too restrictive, breaks action-oriented deferred prompts ("search for overdue tasks and report them").
- **Read-only tools during proactive execution** — prevents useful mutations like "move overdue tasks to blocked status."
- **Filter tools in `invokeLlmWithHistory` by name** — fragile, tool names could change silently.

## Testing

- Unit test: `makeTools` with `mode='proactive'` excludes deferred prompt tools.
- Unit test: `buildProactiveTrigger` output includes spotlighting delimiters and updated system lines.
- Manual test: schedule a reminder, verify delivery without recursive scheduling.
