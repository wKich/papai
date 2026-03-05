# Markdown to HTML Formatting Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate markdown-to-html conversion layer to properly format LLM responses in Telegram using HTML parse mode.

**Architecture:** Add Marked library to convert LLM Markdown output to HTML. Bot sends messages with `parse_mode='HTML'` to Telegram. No fallbacks, no system prompt changes.

**Tech Stack:** Marked (Markdown to HTML), Grammy (Telegram bot framework), TypeScript

---

## Prerequisites

**Environment Setup:**

```bash
cd /Users/ki/Projects/experiments/papai
git switch -c feature/markdown-formatting
```

**Existing Context:**

- Design document: `docs/plans/2026-03-05-markdown-formatting-design.md`
- Existing bot framework: `src/bot.ts` already handles LLM orchestration
- Current message flow: Plain text only (`ctx.reply(text)`)
- Need to convert to: HTML formatting (`ctx.reply(html, { parse_mode: 'HTML' })`)

---

## Task 1: Create Format Converter Utility

**Files:**

- Create: `src/utils/markdown.ts`
- Test: `tests/utils/markdown.test.ts`

### Step 1: Write the failing test

````typescript
// tests/utils/markdown.test.ts
import { describe, test, expect } from 'bun:test'
import { formatMarkdownToHtml } from '../../src/utils/markdown'

describe('formatMarkdownToHtml', () => {
  test('converts bold text', () => {
    const input = '**bold**'
    const result = formatMarkdownToHtml(input)
    expect(result).toContain('<b>bold</b>')
  })

  test('converts italic text', () => {
    const input = '_italic_'
    const result = formatMarkdownToHtml(input)
    expect(result).toContain('<i>italic</i>')
  })

  test('converts links', () => {
    const input = '[text](http://example.com)'
    const result = formatMarkdownToHtml(input)
    expect(result).toContain('<a href="http://example.com">text</a>')
  })

  test('converts inline code', () => {
    const input = '`code`'
    const result = formatMarkdownToHtml(input)
    expect(result).toContain('<code>code</code>')
  })

  test('converts code blocks', () => {
    const input = '```typescript\nconsole.log("hi")\n```'
    const result = formatMarkdownToHtml(input)
    expect(result).toContain('<pre><code')
    expect(result).toContain('language-typescript')
  })

  test('handles plain text', () => {
    const input = 'just text'
    const result = formatMarkdownToHtml(input)
    expect(result).toContain('<p>just text</p>')
  })
})
````

### Step 2: Run test to verify it fails

```bash
bun test tests/utils/markdown.test.ts
```

**Expected output:** `FAIL src/utils/markdown.ts | No tests found` or `formatMarkdownToHtml is not defined`

### Step 3: Create the utility file

```typescript
// src/utils/markdown.ts
import { marked } from 'marked'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'markdown' })

/**
 * Converts LLM Markdown response to Telegram-compatible HTML
 * @param markdown - LLM output in Markdown format
 * @returns HTML string ready for Telegram parse_mode='HTML'
 */
export const formatMarkdownToHtml = (markdown: string): string => {
  log.debug({ markdownLength: markdown.length }, 'Converting Markdown to HTML')
  const html = marked(markdown, {
    breaks: false,
    gfm: false,
  })
  log.debug({ markdownLength: markdown.length, htmlLength: html.length }, 'Markdown converted to HTML')
  return html
}
```

### Step 4: Run test to verify it passes (will fail until Step 5)

### Step 5: Install marked dependency

```bash
bun add marked
```

### Step 6: Rerun test to verify it passes

```bash
bun test tests/utils/markdown.test.ts
```

**Expected output:** All 6 tests PASS

### Step 7: Commit

```bash
git add src/utils/markdown.ts tests/utils/markdown.test.ts package.json package-lock.json
git commit -m "feat: add markdown to HTML converter utility

- Create formatMarkdownToHtml() function in src/utils/markdown.ts
- Configure marked with breaks:false and gfm:false
- Add logging for markdown and html lengths
- Add comprehensive unit tests for all formatting types
- Install marked v15.0.0 as dependency"
```

---

## Task 2: Update Bot to Use HTML Parse Mode

**Files:**

- Modify: `src/bot.ts:106`
- Test: `tests/bot.test.ts` (integration test)

### Step 1: Write failing integration test

```typescript
// tests/bot.test.ts
import { describe, test, expect, beforeEach, afterEach, vi } from 'bun:test'
import { Context } from 'grammy'
import { callLlm } from '../src/bot'
import { formatMarkdownToHtml } from '../src/utils/markdown'

vi.mock('../src/utils/markdown', () => ({
  formatMarkdownToHtml: vi.fn((text) => `<p>${text}</p>`),
}))

describe('bot HTML formatting', () => {
  let ctx: Context
  let mockReply: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockReply = vi.fn().mockResolvedValue(undefined)
    ctx = {
      from: { id: 123456 },
      reply: mockReply,
    } as unknown as Context
  })

  test('uses HTML parse mode for bot responses', async () => {
    const mockResult = {
      text: '**test** message',
      toolCalls: [],
      response: { messages: [] },
      usage: { inputTokens: 10, outputTokens: 10 },
    }

    // Simulate callLlm behavior
    const formattedText = formatMarkdownToHtml(mockResult.text)
    await mockReply(formattedText, { parse_mode: 'HTML' })

    expect(mockReply).toHaveBeenCalledWith(formattedText, { parse_mode: 'HTML' })
  })
})
```

### Step 2: Run test to verify it fails

```bash
bun test tests/bot.test.ts
```

**Expected:** FAIL - callLlm not called with parse_mode

### Step 3: Add import to bot.ts

```typescript
// src/bot.ts (around line 10)
import { formatMarkdownToHtml } from './utils/markdown.js'
```

### Step 4: Update reply call in callLlm

```typescript
// src/bot.ts (around line 104-106)
// Before:
const assistantText = result.text
conversationHistory.set(userId, [...history, ...result.response.messages])
await ctx.reply(assistantText || 'Done.')

// After:
const assistantText = result.text
const formattedText = formatMarkdownToHtml(assistantText || 'Done.')
conversationHistory.set(userId, [...history, ...result.response.messages])
await ctx.reply(formattedText, { parse_mode: 'HTML' })
```

### Step 5: Run integration test to verify it passes

```bash
bun test tests/bot.test.ts
```

**Expected:** All tests PASS

### Step 6: Update existing bot tests (if any fail)

Run all bot tests:

```bash
bun test tests/bot.test.ts
```

Fix any tests that mock `ctx.reply` to include parse_mode check.

### Step 7: Commit

```bash
git add src/bot.ts tests/bot.test.ts
git commit -m "feat: integrate markdown conversion with HTML parse mode

- Import formatMarkdownToHtml utility
- Convert LLM output before sending to Telegram
- Use parse_mode='HTML' in ctx.reply call
- Add integration test for HTML formatting
"
```

---

## Task 3: Manual Testing

**Files:**

- None (manual verification)

### Step 1: Start the bot

```bash
bun run start
```

### Step 2: Send test messages via Telegram

Send these messages and verify formatting renders correctly:

1. **Bold test:**

   ```
   Please **bold** this text
   ```

2. **Italic test:**

   ```
   Please *italicize* this text
   ```

3. **Link test:**

   ```
   Check this [link](https://linear.app)
   ```

4. **Code test:**

   ```
   Use `console.log()` for debugging
   ```

5. **Code block test:**

   ````
   ```javascript
   function test() {
     return true;
   }
   ````

   ```

   ```

6. **Combined test:**
   ```
   Created issue **PAP-42**: Fix **login** bug. See [Linear](https://linear.app) for details.
   ```

### Step 3: Verify formatting

- Bold should render as bold in Telegram
- Italic should render as italic
- Links should be clickable
- Code should be monospace
- Code blocks should have line breaks and monospace font

### Step 4: Verify no errors

Check logs for any markdown conversion errors:

```bash
# Terminal watching logs
grep "markdown" /var/log/app.log
```

Expected: No errors, only debug logs with lengths

### Step 5: Commit

If everything works:

```bash
git commit --allow-empty -m "test: manual verification of markdown formatting completed

Verified:
- Bold formatting renders correctly
- Italic formatting renders correctly
- Links are clickable
- Inline code renders as monospace
- Code blocks render with line breaks
- No conversion errors in logs
"
```

---

## Task 4: Final Verification

**Files:**

- None

### Step 1: Run full test suite

```bash
bun test
```

Expected: All tests PASS (including existing tests)

### Step 2: Run linting

```bash
bun run lint
```

Expected: 0 warnings, 0 errors

### Step 3: Run formatter

```bash
bun run format
```

Expected: Files formatted, no errors

### Step 4: Verify package.json

```bash
cat package.json | grep -A2 '"marked"'
```

Expected: `"marked": "^15.0.0"` in dependencies

### Step 5: Commit final changes

```bash
git add .
git commit -m "test: verify all tests pass and linting clean"
```

---

## Verification Checklist

- [ ] All unit tests pass (`bun test src/utils/markdown.test.ts`)
- [ ] Integration test passes (`bun test src/bot.test.ts`)
- [ ] Full test suite passes (`bun test`)
- [ ] No linting errors (`bun run lint`)
- [ ] Code is formatted (`bun run format`)
- [ ] Marked package installed
- [ ] Manual testing verified (bold, italic, links, code)
- [ ] No errors in logs
- [ ] Design doc references implemented features

---

## Rollback Plan

If issues occur:

```bash
git revert HEAD~1..HEAD
git push
bun run start
```

This reverts the feature branch to previous state and restores plain-text messaging.

---

## References

- Design document: `docs/plans/2026-03-05-markdown-formatting-design.md`
- Marked docs: https://marked.js.org/
- Telegram HTML docs: https://core.telegram.org/bots/api#html-style
