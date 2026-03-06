# Markdown Formatting Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate @gramio/format to convert LLM Markdown output to Telegram MessageEntity format, eliminating 400 Bad Request errors from unsupported HTML tags.

**Architecture:** Use `markdownToFormattable()` from @gramio/format to parse LLM Markdown into `{text, entities}` format, then send messages using `ctx.reply(text, {entities})` instead of `parse_mode`.

**Tech Stack:** @gramio/format, marked (peer dependency), grammy, TypeScript, Bun test runner

---

## Prerequisites

**Environment Setup:**

```bash
cd /Users/ki/Projects/experiments/papai
git status
```

**Verify clean working directory before starting.**

---

## Task 1: Install Dependencies

**Files:**

- Modify: `package.json`
- Modify: `bun.lock`

### Step 1: Install @gramio/format and marked

```bash
bun add @gramio/format marked
```

**Expected output:** Both packages installed, bun.lock updated

### Step 2: Verify installation

```bash
cat package.json | grep -A2 '"@gramio/format"'
cat package.json | grep -A2 '"marked"'
```

**Expected output:** Shows versions for both packages in dependencies

### Step 3: Commit

```bash
git add package.json bun.lock
git commit -m "chore: add @gramio/format and marked dependencies

- Install @gramio/format for Markdown to MessageEntity conversion
- Install marked as peer dependency"
```

---

## Task 2: Create Format Utility

**Files:**

- Create: `src/utils/format.ts`
- Test: `tests/utils/format.test.ts`

### Step 1: Create directory structure

```bash
mkdir -p src/utils tests/utils
```

### Step 2: Write failing test

**File:** `tests/utils/format.test.ts`

````typescript
import { describe, test, expect } from 'bun:test'
import { formatLlmOutput } from '../../src/utils/format.js'

describe('formatLlmOutput', () => {
  test('converts bold text to entities', () => {
    const result = formatLlmOutput('**bold**')
    expect(result.text).toBe('bold')
    expect(result.entities).toHaveLength(1)
    expect(result.entities[0]).toMatchObject({
      type: 'bold',
      offset: 0,
      length: 4,
    })
  })

  test('converts italic text to entities', () => {
    const result = formatLlmOutput('*italic*')
    expect(result.text).toBe('italic')
    expect(result.entities).toHaveLength(1)
    expect(result.entities[0]).toMatchObject({
      type: 'italic',
      offset: 0,
      length: 6,
    })
  })

  test('converts links to text_link entities', () => {
    const result = formatLlmOutput('[text](http://example.com)')
    expect(result.text).toBe('text')
    expect(result.entities).toHaveLength(1)
    expect(result.entities[0]).toMatchObject({
      type: 'text_link',
      offset: 0,
      length: 4,
      url: 'http://example.com',
    })
  })

  test('converts code blocks to pre entities', () => {
    const result = formatLlmOutput('```typescript\nconsole.log("hi")\n```')
    expect(result.text).toBe('console.log("hi")')
    expect(result.entities).toHaveLength(1)
    expect(result.entities[0]).toMatchObject({
      type: 'pre',
      offset: 0,
      length: 17,
    })
  })

  test('converts headers to bold entities', () => {
    const result = formatLlmOutput('# Title')
    expect(result.text).toBe('Title')
    expect(result.entities).toHaveLength(1)
    expect(result.entities[0]).toMatchObject({
      type: 'bold',
      offset: 0,
      length: 5,
    })
  })

  test('handles multiple formatting elements', () => {
    const result = formatLlmOutput('**bold** and *italic*')
    expect(result.text).toBe('bold and italic')
    expect(result.entities).toHaveLength(2)
    expect(result.entities[0]).toMatchObject({ type: 'bold', offset: 0, length: 4 })
    expect(result.entities[1]).toMatchObject({ type: 'italic', offset: 9, length: 6 })
  })

  test('handles unclosed bold gracefully', () => {
    const result = formatLlmOutput('**unclosed')
    expect(result.text).toBe('**unclosed')
    expect(result.entities).toHaveLength(0)
  })

  test('handles plain text without entities', () => {
    const result = formatLlmOutput('just plain text')
    expect(result.text).toBe('just plain text')
    expect(result.entities).toHaveLength(0)
  })
})
````

### Step 3: Run test to verify it fails

```bash
bun test tests/utils/format.test.ts
```

**Expected output:** FAIL - "formatLlmOutput is not defined" or module not found

### Step 4: Create the utility file

**File:** `src/utils/format.ts`

```typescript
import { markdownToFormattable } from '@gramio/format/markdown'
import type { FormattableString } from '@gramio/format'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'format' })

/**
 * Converts LLM Markdown response to Telegram-compatible MessageEntity format
 * @param markdown - LLM output in Markdown format
 * @returns FormattableString with text and entities ready for Telegram
 */
export const formatLlmOutput = (markdown: string): FormattableString => {
  log.debug({ markdownLength: markdown.length }, 'Converting Markdown to entities')
  const result = markdownToFormattable(markdown)
  log.debug(
    {
      textLength: result.text.length,
      entityCount: result.entities.length,
    },
    'Markdown converted to entities',
  )
  return result
}
```

### Step 5: Run test to verify it passes

```bash
bun test tests/utils/format.test.ts
```

**Expected output:** All 8 tests PASS

### Step 6: Commit

```bash
git add src/utils/format.ts tests/utils/format.test.ts
git commit -m "feat: add format utility for Markdown to MessageEntity conversion

- Create formatLlmOutput() function using @gramio/format
- Add comprehensive unit tests for all markdown elements
- Handle graceful degradation for malformed markdown"
```

---

## Task 3: Integrate with Bot

**Files:**

- Modify: `src/bot.ts:1-10` (add import)
- Modify: `src/bot.ts:104-106` (update reply call)
- Test: `tests/bot.test.ts` (add integration test)

### Step 1: Add import to bot.ts

**File:** `src/bot.ts` (add after line 5)

```typescript
import { formatLlmOutput } from './utils/format.js'
```

### Step 2: Update reply call in callLlm function

**File:** `src/bot.ts` (around line 104-106)

Change from:

```typescript
const assistantText = result.text
conversationHistory.set(userId, [...history, ...result.response.messages])
await ctx.reply(assistantText || 'Done.')
```

To:

```typescript
const assistantText = result.text
const formatted = formatLlmOutput(assistantText || 'Done.')
conversationHistory.set(userId, [...history, ...result.response.messages])
await ctx.reply(formatted.text, { entities: formatted.entities })
```

### Step 3: Add integration test

**File:** `tests/bot.test.ts` (append to existing file)

```typescript
import { formatLlmOutput } from '../src/utils/format.js'

describe('bot message formatting', () => {
  test('formatLlmOutput converts markdown to entities', () => {
    const result = formatLlmOutput('**bold** text')
    expect(result.text).toBe('bold text')
    expect(result.entities).toHaveLength(1)
    expect(result.entities[0].type).toBe('bold')
  })

  test('formatLlmOutput handles plain text', () => {
    const result = formatLlmOutput('plain text')
    expect(result.text).toBe('plain text')
    expect(result.entities).toHaveLength(0)
  })
})
```

### Step 4: Run all bot tests

```bash
bun test tests/bot.test.ts
```

**Expected output:** All tests PASS (including existing smoke test)

### Step 5: Commit

```bash
git add src/bot.ts tests/bot.test.ts
git commit -m "feat: integrate markdown formatting with bot

- Import formatLlmOutput utility in bot.ts
- Convert LLM output before sending to Telegram
- Send messages with entities instead of parse_mode
- Add integration tests for formatting"
```

---

## Task 4: Final Verification

**Files:** None

### Step 1: Run full test suite

```bash
bun test
```

**Expected output:** All tests PASS (including existing tests)

### Step 2: Run linting

```bash
bun run lint
```

**Expected output:** 0 warnings, 0 errors

### Step 3: Run formatter

```bash
bun run format
```

**Expected output:** Files formatted, no errors

### Step 4: Verify dependencies

```bash
cat package.json | grep -E '"@gramio/format"|"marked"'
```

**Expected output:** Shows both packages in dependencies

### Step 5: Commit final changes

```bash
git add .
git commit -m "test: verify all tests pass and linting clean"
```

---

## Verification Checklist

- [ ] Dependencies installed (`@gramio/format`, `marked`)
- [ ] Format utility created with proper logging
- [ ] Unit tests pass for all markdown elements
- [ ] Bot integration complete (import + usage)
- [ ] Integration tests pass
- [ ] Full test suite passes
- [ ] Linting clean (0 errors, 0 warnings)
- [ ] Code formatted
- [ ] All commits made

---

## Rollback Plan

If issues occur:

```bash
git revert HEAD~3..HEAD
git push
bun run start
```

This reverts all 3 commits (dependencies, format utility, bot integration) to previous state.

---

## References

- Design document: `docs/plans/2026-03-06-markdown-formatting-design.md`
- @gramio/format docs: https://gramio.dev/formatting/
- Telegram MessageEntity API: https://core.telegram.org/bots/api#messageentity
