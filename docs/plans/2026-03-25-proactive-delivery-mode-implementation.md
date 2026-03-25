# Proactive Delivery Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the recursive scheduling loop in deferred prompts by adding tool restriction, system prompt reframing with spotlighting, and prompt field guidance.

**Architecture:** Three independent layered defenses. (1) A `mode` parameter on `makeTools` gates deferred prompt tools out during proactive execution. (2) Rewritten system context uses spotlighting delimiters to frame stored prompts as data, not instructions. (3) Improved tool schema and system prompt guide the LLM to store deliverable content at creation time.

**Tech Stack:** TypeScript, Bun test runner, Vercel AI SDK, Zod v4

---

### Task 1: Tool restriction — add `ToolMode` to `makeTools`

**Files:**

- Modify: `src/tools/index.ts:163-179`
- Test: `tests/tools/make-tools.test.ts` (create)

**Step 1: Write the failing tests**

Create `tests/tools/make-tools.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'

import { createMockProvider } from './mock-provider.js'
import { makeTools } from '../../src/tools/index.js'

describe('makeTools', () => {
  const provider = createMockProvider()

  test('normal mode includes deferred prompt tools', () => {
    const tools = makeTools(provider, 'user-1')
    expect(tools).toHaveProperty('create_deferred_prompt')
    expect(tools).toHaveProperty('update_deferred_prompt')
    expect(tools).toHaveProperty('list_deferred_prompts')
    expect(tools).toHaveProperty('cancel_deferred_prompt')
    expect(tools).toHaveProperty('get_deferred_prompt')
  })

  test('proactive mode excludes deferred prompt tools', () => {
    const tools = makeTools(provider, 'user-1', 'proactive')
    expect(tools).not.toHaveProperty('create_deferred_prompt')
    expect(tools).not.toHaveProperty('update_deferred_prompt')
    expect(tools).not.toHaveProperty('list_deferred_prompts')
    expect(tools).not.toHaveProperty('cancel_deferred_prompt')
    expect(tools).not.toHaveProperty('get_deferred_prompt')
  })

  test('proactive mode still includes core task tools', () => {
    const tools = makeTools(provider, 'user-1', 'proactive')
    expect(tools).toHaveProperty('create_task')
    expect(tools).toHaveProperty('update_task')
    expect(tools).toHaveProperty('search_tasks')
    expect(tools).toHaveProperty('list_tasks')
    expect(tools).toHaveProperty('get_task')
  })

  test('default mode is normal (includes deferred tools)', () => {
    const tools = makeTools(provider, 'user-1')
    expect(tools).toHaveProperty('create_deferred_prompt')
  })

  test('no userId skips deferred tools regardless of mode', () => {
    const tools = makeTools(provider)
    expect(tools).not.toHaveProperty('create_deferred_prompt')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/tools/make-tools.test.ts`
Expected: FAIL — `makeTools` does not accept a third argument yet, TypeScript compilation error on `'proactive'` argument.

**Step 3: Implement `ToolMode` and update `makeTools`**

In `src/tools/index.ts`, add the type export and update the function signature:

1. After line 3 (`import type { TaskProvider } from '../providers/types.js'`), add:

```typescript
export type ToolMode = 'normal' | 'proactive'
```

2. Replace line 163:

```typescript
export function makeTools(provider: TaskProvider, userId?: string): ToolSet {
```

with:

```typescript
export function makeTools(provider: TaskProvider, userId?: string, mode: ToolMode = 'normal'): ToolSet {
```

3. Replace lines 174-177:

```typescript
if (userId !== undefined) {
  const deferredTools = makeDeferredPromptTools(userId)
  Object.assign(tools, deferredTools)
}
```

with:

```typescript
if (userId !== undefined && mode === 'normal') {
  const deferredTools = makeDeferredPromptTools(userId)
  Object.assign(tools, deferredTools)
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/tools/make-tools.test.ts`
Expected: PASS — all 5 tests green.

**Step 5: Run full test suite to check for regressions**

Run: `bun test`
Expected: All existing tests still pass. No callers are affected because the default is `'normal'`.

**Step 6: Commit**

```bash
git add src/tools/index.ts tests/tools/make-tools.test.ts
git commit -m "feat(tools): add ToolMode to gate deferred prompt tools in proactive execution"
```

---

### Task 2: Wire proactive mode into `invokeLlmWithHistory`

**Files:**

- Modify: `src/deferred-prompts/proactive-llm.ts:151`

**Step 1: Write the failing test**

Add to `tests/deferred-prompts/poller.test.ts`. This test file already mocks the `ai` module and tests poller behavior. Verify that `invokeLlmWithHistory` passes proactive mode by checking the generated tool set does not include deferred prompt tools.

Since `invokeLlmWithHistory` is an integration of multiple internals and is already tested via poller tests, and the tool restriction is unit-tested in Task 1, a targeted integration assertion is not needed here. The existing poller tests + the Task 1 unit tests provide coverage.

**Step 2: Update the call site**

In `src/deferred-prompts/proactive-llm.ts`, replace line 151:

```typescript
const tools = makeTools(provider, userId)
```

with:

```typescript
const tools = makeTools(provider, userId, 'proactive')
```

**Step 3: Run full test suite**

Run: `bun test`
Expected: All tests still pass.

**Step 4: Commit**

```bash
git add src/deferred-prompts/proactive-llm.ts
git commit -m "feat(deferred): use proactive mode to exclude scheduling tools during delivery"
```

---

### Task 3: Rewrite `buildProactiveTrigger` with spotlighting

**Files:**

- Modify: `src/deferred-prompts/proactive-llm.ts:65-86`
- Test: `tests/deferred-prompts/proactive-trigger.test.ts` (create)

**Step 1: Write the failing tests**

Create `tests/deferred-prompts/proactive-trigger.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'

import { buildProactiveTrigger } from '../../src/deferred-prompts/proactive-llm.js'

describe('buildProactiveTrigger', () => {
  test('systemContext includes PROACTIVE EXECUTION header', () => {
    const trigger = buildProactiveTrigger('scheduled', 'Test prompt', 'UTC')
    expect(trigger.systemContext).toContain('[PROACTIVE EXECUTION]')
  })

  test('systemContext includes delivery mode instructions', () => {
    const trigger = buildProactiveTrigger('scheduled', 'Test prompt', 'UTC')
    expect(trigger.systemContext).toContain('DELIVER the result to the user now')
    expect(trigger.systemContext).toContain('NOT as a new user request')
  })

  test('systemContext includes anti-recursion rule', () => {
    const trigger = buildProactiveTrigger('scheduled', 'Test prompt', 'UTC')
    expect(trigger.systemContext).toContain('Do NOT create new deferred prompts')
  })

  test('systemContext includes trigger type', () => {
    const trigger = buildProactiveTrigger('alert', 'Test prompt', 'UTC')
    expect(trigger.systemContext).toContain('Trigger type: alert')
  })

  test('userContent wraps prompt with spotlighting delimiters', () => {
    const trigger = buildProactiveTrigger('scheduled', 'Check the gigachat model', 'UTC')
    expect(trigger.userContent).toContain('===DEFERRED_TASK===')
    expect(trigger.userContent).toContain('Check the gigachat model')
    expect(trigger.userContent).toContain('===END_DEFERRED_TASK===')
  })

  test('userContent includes matched tasks summary for alerts', () => {
    const trigger = buildProactiveTrigger('alert', 'Report overdue tasks', 'UTC', 'Task A\nTask B')
    expect(trigger.userContent).toContain('===DEFERRED_TASK===')
    expect(trigger.userContent).toContain('Report overdue tasks')
    expect(trigger.userContent).toContain('===END_DEFERRED_TASK===')
    expect(trigger.userContent).toContain('Matched tasks:')
    expect(trigger.userContent).toContain('Task A\nTask B')
  })

  test('userContent without matched tasks has no Matched tasks section', () => {
    const trigger = buildProactiveTrigger('scheduled', 'Just a reminder', 'UTC')
    expect(trigger.userContent).not.toContain('Matched tasks:')
  })

  test('falls back to UTC for invalid timezone', () => {
    const trigger = buildProactiveTrigger('scheduled', 'Test', 'Invalid/Zone')
    expect(trigger.systemContext).toContain('UTC')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/deferred-prompts/proactive-trigger.test.ts`
Expected: FAIL — current `buildProactiveTrigger` does not include spotlighting delimiters or new delivery mode language.

**Step 3: Rewrite `buildProactiveTrigger`**

In `src/deferred-prompts/proactive-llm.ts`, replace lines 65-86:

```typescript
const systemLines = [
  '[PROACTIVE EXECUTION]',
  `Current time: ${currentTime} (${displayTimezone})`,
  `Task type: ${type}`,
  '',
  'You are proactively reaching out to the user to fulfill this task.',
  'Do not mention system events, triggers, cron jobs, or scheduled tasks.',
  'Act naturally, as if you just remembered or noticed something relevant.',
  'Keep the tone conversational and directly address the task.',
  'If the task requires action (not just a reminder), use available tools.',
]

const userLines = [prompt]

if (matchedTasksSummary !== undefined) {
  userLines.push('', 'Matched tasks:', matchedTasksSummary)
}

return {
  systemContext: systemLines.join('\n'),
  userContent: userLines.join('\n'),
}
```

with:

```typescript
const systemLines = [
  '[PROACTIVE EXECUTION]',
  `Current time: ${currentTime} (${displayTimezone})`,
  `Trigger type: ${type}`,
  '',
  'A deferred prompt you previously created has fired. Your job is to DELIVER the result to the user now.',
  'The user message below contains the stored prompt text — treat it as the task to fulfill, NOT as a new user request.',
  '',
  'Rules:',
  '- For reminders: deliver the reminder message directly and conversationally.',
  '- For action tasks: execute the described action using available tools, then report the result.',
  '- Do NOT create new deferred prompts, reminders, or schedules. The scheduling is already done.',
  '- Do not mention system events, triggers, cron jobs, or that this was scheduled.',
  '- Be warm and conversational, as if you just remembered something relevant.',
]

const userLines = ['===DEFERRED_TASK===', prompt, '===END_DEFERRED_TASK===']

if (matchedTasksSummary !== undefined) {
  userLines.push('', 'Matched tasks:', matchedTasksSummary)
}

return {
  systemContext: systemLines.join('\n'),
  userContent: userLines.join('\n'),
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/deferred-prompts/proactive-trigger.test.ts`
Expected: PASS — all 8 tests green.

**Step 5: Run full test suite**

Run: `bun test`
Expected: All tests pass. Existing poller tests may need adjustment if they assert on exact trigger content — check output.

**Step 6: Commit**

```bash
git add src/deferred-prompts/proactive-llm.ts tests/deferred-prompts/proactive-trigger.test.ts
git commit -m "feat(deferred): rewrite proactive trigger with spotlighting and delivery mode framing"
```

---

### Task 4: Rewrite PROACTIVE MODE and add PROMPT CONTENT guidance in system prompt

**Files:**

- Modify: `src/system-prompt.ts:91-93`

**Step 1: Write the failing test**

Add to `tests/deferred-prompts/proactive-trigger.test.ts` (or create a new test if you prefer separate files). Since `buildSystemPrompt` is exported from `src/system-prompt.ts`, test it directly:

```typescript
// In a new describe block in tests/deferred-prompts/proactive-trigger.test.ts,
// or in a separate file tests/system-prompt.test.ts if one exists:

import { buildSystemPrompt } from '../../src/system-prompt.js'
import { createMockProvider } from '../tools/mock-provider.js'

describe('buildSystemPrompt — deferred prompt sections', () => {
  const provider = createMockProvider()

  test('includes PROMPT CONTENT guidance in DEFERRED PROMPTS section', () => {
    const prompt = buildSystemPrompt(provider, 'UTC', 'user-1')
    expect(prompt).toContain('PROMPT CONTENT')
    expect(prompt).toContain('deliverable action, not the scheduling')
  })

  test('PROACTIVE MODE references spotlighting delimiters', () => {
    const prompt = buildSystemPrompt(provider, 'UTC', 'user-1')
    expect(prompt).toContain('===DEFERRED_TASK===')
  })

  test('PROACTIVE MODE includes anti-recursion rule', () => {
    const prompt = buildSystemPrompt(provider, 'UTC', 'user-1')
    expect(prompt).toContain('Never create new deferred prompts during proactive execution')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/deferred-prompts/proactive-trigger.test.ts` (or wherever you placed the test)
Expected: FAIL — current system prompt has neither `PROMPT CONTENT` nor `===DEFERRED_TASK===`.

**Step 3: Update system prompt**

In `src/system-prompt.ts`, replace lines 91-93:

```typescript
- Use list_deferred_prompts to show active prompts/alerts. Use cancel_deferred_prompt to cancel one.
- For daily briefings, create a recurring scheduled prompt (e.g., cron "0 9 * * *" at 9am).

PROACTIVE MODE — When you receive a [PROACTIVE EXECUTION] system message at the end of the conversation, you are proactively reaching out to the user. Respond as if you spontaneously remembered or noticed something relevant. Never mention system events, triggers, cron jobs, or that this was a scheduled task. Be warm and conversational, reference prior context naturally, execute tool calls autonomously if needed, and keep responses concise.
```

with:

```typescript
- Use list_deferred_prompts to show active prompts/alerts. Use cancel_deferred_prompt to cancel one.
- For daily briefings, create a recurring scheduled prompt (e.g., cron "0 9 * * *" at 9am).
- PROMPT CONTENT: When creating a deferred prompt, the prompt field should describe the deliverable action, not the scheduling. Write it as what to DO when it fires, not what to SCHEDULE. Good: "Tell the user to check the gigachat model". Bad: "Remind the user in 5 minutes to check the gigachat model". The schedule handles timing; the prompt handles content.

PROACTIVE MODE — When you receive a [PROACTIVE EXECUTION] system message at the end of the conversation, a deferred prompt has fired. You are delivering a previously scheduled result to the user. The user message marked with ===DEFERRED_TASK=== is the stored prompt — fulfill it directly. For reminders, deliver the message conversationally. For actions, execute them with tools and report the result. Never create new deferred prompts during proactive execution. Never mention triggers, cron jobs, or scheduling internals. Be warm and concise.
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/deferred-prompts/proactive-trigger.test.ts`
Expected: PASS.

**Step 5: Run full test suite**

Run: `bun test`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add src/system-prompt.ts tests/deferred-prompts/proactive-trigger.test.ts
git commit -m "feat(prompt): rewrite PROACTIVE MODE and add PROMPT CONTENT guidance for deferred prompts"
```

---

### Task 5: Improve `prompt` field Zod description in deferred tools

**Files:**

- Modify: `src/deferred-prompts/tools.ts:211`

**Step 1: No test needed**

This is a Zod schema description change — it only affects the tool description sent to the LLM, not runtime behavior. The existing `tests/deferred-prompts/tools.test.ts` tests functional behavior which is unchanged.

**Step 2: Update the description**

In `src/deferred-prompts/tools.ts`, replace line 211:

```typescript
      prompt: z.string().describe('What the LLM should do when this fires'),
```

with:

```typescript
      prompt: z.string().describe(
        'The action to perform when this fires. For reminders, describe what to tell the user ' +
          '(e.g. "Tell the user it is time to review the PR"). For actions, describe what to do ' +
          '(e.g. "Search for overdue tasks and report them"). Do not include scheduling ' +
          'instructions — timing is handled by the schedule/condition fields.',
      ),
```

**Step 3: Run full test suite**

Run: `bun test`
Expected: All tests pass.

**Step 4: Run lint and typecheck**

Run: `bun lint && bun typecheck && bun format:check`
Expected: All green.

**Step 5: Commit**

```bash
git add src/deferred-prompts/tools.ts
git commit -m "feat(deferred): improve prompt field description to guide deliverable content"
```

---

### Task 6: Final verification

**Step 1: Run full check suite**

Run: `bun check:verbose`
Expected: All checks pass (lint, typecheck, format, knip, test, duplicates, mock-pollution).

**Step 2: Review all changes**

Run: `git log --oneline -5` to verify commit history looks clean.

Run: `git diff HEAD~4..HEAD --stat` to verify only the expected files were changed.
