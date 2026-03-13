# Telegram Markdown to HTML Formatting

**Date:** 2026-03-05  
**Author:** AI Assistant  
**Status:** Approved for implementation

---

## Overview

This design addresses formatting of messages between Telegram and the LLM. Currently, LLM responses are sent as raw text to Telegram. This design introduces a Markdown-to-HTML format conversion layer to properly render formatted text (bold, italic, links, code) in Telegram messages.

---

## Requirements

**User Requirements:**

1. LLM outputs raw Markdown
2. Users can send plain text or Markdown to the bot
3. Only basic formatting: bold, italic, links, code blocks (inline and pre-formatted)
4. No fallback mechanisms - always convert, let Telegram handle gracefully
5. No system prompt changes - LLM already knows how to format Markdown

**Technical Constraints:**

- No sanitization of HTML output
- Minimal dependencies
- Fast conversion (bot must respond quickly)

---

## Approach: Format Conversion Layer

### Architecture

```
User (Markdown/plain) → Telegram → Bot → pass through → LLM (outputs Markdown)
→ formatMarkdownToHtml() → Bot (parse_mode='HTML') → Telegram renders
```

**Key Components:**

1. **Markdown converter utility** - Converts LLM Markdown → HTML
2. **Bot integration** - Uses `parse_mode='HTML'` when sending to Telegram
3. **No changes to LLM system prompt** - Trust LLM's natural Markdown formatting

### Trade-offs

**Advantages:**

- Fast and lightweight using `marked` library
- Minimal code changes (2 files, ~15 lines total)
- Telegram-native HTML support works well
- No sanitization overhead

**Disadvantages:**

- LLM must output valid Markdown
- Telegram limits message length to 4096 characters
- Telegram HTML has some tag restrictions (no `<p>`, `<h1>`, etc.)

---

## Component Design

### 1. Format Converter (`src/utils/markdown.ts`)

**Purpose:** Convert LLM Markdown output to Telegram-compatible HTML.

**Implementation:**

```typescript
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
  const html = marked.parse(markdown, {
    async: false,
    breaks: false,
    gfm: false,
  })
  log.debug({ markdownLength: markdown.length, htmlLength: html.length }, 'Markdown converted to HTML')
  return html
}
```

**Configuration Rationale:**

| Option   | Value   | Reason                                                                                                |
| -------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `gfm`    | `false` | Disable GitHub Flavored Markdown extras (tables, strikethrough, task lists) not supported by Telegram |
| `breaks` | `false` | Disable converting single newlines to `<br>` (LLM output uses double-newlines)                        |

**Supported Output Tags:**

- Bold: `**text**` → `<strong>text</strong>`
- Italic: `_text_` → `<em>text</em>`
- Links: `[text](url)` → `<a href="url">text</a>`
- Inline code: `` `code` `` → `<code>code</code>`
- Code blocks: ` `lang\ncode` ` → `<pre><code class="language-lang">code</code></pre>`

**Unsupported (by `marked` config; generated but ignored by Telegram):**

- Tables
- Strikethrough (`~~text~~`)

Headers and lists are supported by CommonMark (not GFM) and are generated. Telegram strips `<h1>`-`<h6>`, `<ul>`, `<ol>`, `<li>` tags but preserves text content.

**Logging:**

- `debug` on entry (markdown length)
- `debug` on exit (html length)
- No error handling - errors propagate up

---

### 2. Bot Integration (`src/bot.ts`)

**Changes Required:**

**A. Add import at top:**

```typescript
import { formatMarkdownToHtml } from './utils/markdown.js'
```

**B. Update `callLlm` function (around line 106):**

```typescript
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

**Key Changes:**

1. Convert LLM output using `formatMarkdownToHtml()`
2. Send with `parse_mode: 'HTML'` option
3. No fallback logic - always convert

---

### 3. Dependencies (`package.json`)

**Add to dependencies:**

```json
"marked": "^15.0.0"
```

**Rationale for `marked`:**

- Fastest markdown parser (20x faster than alternatives)
- Well-maintained (last push Feb 2026, 36K+ stars)
- TypeScript support (type-safe)
- No sanitizer needed (doesn't render HTML from untrusted source)
- Simple API, single function call
- No XSS concerns (Markdown → HTML only)

---

## Testing Strategy

### Unit Tests (`tests/utils/markdown.test.ts`)

**Test Cases:**

1. **Bold formatting:**

   ```typescript
   test('converts bold text', () => {
     expect(formatMarkdownToHtml('**bold**')).toContain('<strong>bold</strong>')
   })
   ```

2. **Italic formatting:**

   ```typescript
   test('converts italic text', () => {
     expect(formatMarkdownToHtml('_italic_')).toContain('<em>italic</em>')
   })
   ```

3. **Link formatting:**

   ```typescript
   test('converts links', () => {
     expect(formatMarkdownToHtml('[text](http://example.com)')).toContain('<a href="http://example.com">text</a>')
   })
   ```

4. **Inline code:**

   ```typescript
   test('converts inline code', () => {
     expect(formatMarkdownToHtml('`code`')).toContain('<code>code</code>')
   })
   ```

5. **Code blocks:**

   ````typescript
   test('converts code blocks', () => {
     expect(formatMarkdownToHtml('```typescript\nconsole.log("hi")\n```')).toContain('<pre><code')
   })
   ````

6. **Plain text:**
   ```typescript
   test('converts plain text', () => {
     expect(formatMarkdownToHtml('just text')).toContain('<p>just text</p>')
   })
   ```

**Performance Test:**

```typescript
test('converts markdown in under 10ms for 1KB', () => {
  const largeMarkdown = '-'.repeat(3000)
  const start = performance.now()
  formatMarkdownToHtml(largeMarkdown)
  const duration = performance.now() - start
  expect(duration).toBeLessThan(10)
})
```

### Integration Tests (`tests/bot.test.ts`)

**Test Cases:**

1. **Verify HTML parse mode:**

   ```typescript
   test('sends messages with HTML parse mode', async () => {
     // Mock ctx.reply
     // Send message with markdown
     // Verify ctx.reply called with parse_mode: 'HTML'
   })
   ```

2. **Verify formatting renders:**
   ```typescript
   test('renders bold formatting in Telegram', async () => {
     // Send message with **bold**
     // Verify Telegram receives <b>bold</b>
   })
   ```

---

## Migration Plan

1. **Add `marked` dependency:**

   ```bash
   bun add marked
   ```

2. **Create `src/utils/markdown.ts`:**

   ```bash
   touch src/utils/markdown.ts
   # Write formatMarkdownToHtml function
   ```

3. **Update `src/bot.ts`:**

   ```bash
   # Add import
   # Update callLlm function
   ```

4. **Run tests:**

   ```bash
   bun test
   ```

5. **Test manually:**
   - Send message with `**bold**`
   - Verify Telegram renders bold
   - Send message with `[link](url)`
   - Verify Telegram renders clickable link

---

## Future Considerations

### Potential Enhancements

1. **Syntax highlighting for code blocks:**
   - Currently: `<pre><code>code</code></pre>`
   - Enhancement: Integrate with `highlight.js` for colored syntax
   - Note: Telegram HTML doesn't support CSS, so highlighting may not render

2. **Link preview support:**
   - Telegram auto-detects URLs, but explicit links use `parse_mode='HTML'`
   - Can enable link previews with `link_preview_options` parameter

3. **Custom entities API:**
   - Telegram supports MessageEntity API for more control
   - Alternative to `parse_mode='HTML'`
   - Requires custom Markdown parser, more complex
   - Only consider if HTML limitations become a problem

4. **Telegram MarkdownV2 support:**
   - Alternative: Convert to Telegram's MarkdownV2 format
   - Pros: Native Telegram format, no external dependency
   - Cons: Strict escaping requirements, less familiar syntax
   - Not pursued here - HTML is clearer and more robust

---

## Appendix: Telegram HTML Syntax Reference

**Supported tags:**

- `<b>bold</b>`, `<strong>bold</strong>`
- `<i>italic</i>`, `<em>italic</em>`
- `<u>underline</u>`, `<ins>underline</ins>`
- `<s>strikethrough</s>`, `<strike></strike>`, `<del></del>`
- `<span class="tg-spoiler">spoiler</span>`, `<tg-spoiler>spoiler</tg-spoiler>`
- `<a href="url">link</a>`
- `<code>inline code</code>`
- `<pre>block code</pre>`
- `<pre><code class="language">code</code></pre>`
- `<blockquote>quote</blockquote>`

**Unsupported tags (will render as plain text):**

- `<p>paragraphs</p>`
- `<h1>…h6>headers</h1>`
- `<br>` line breaks
- `<ul>`, `<ol>`, `<li>` lists
- `<div>`, `<span>`, other generic tags (except `class="tg-spoiler"`)

**Key constraint:** Only formatting tags are supported. Block-level elements (paragraphs, headers, lists) are not rendered.

**Note:** `<p>` tags from Marked are stripped by Telegram, but text content remains. This is fine for simple formatting.

---

## References

- [Telegram Bot API - HTML parse mode](https://core.telegram.org/bots/api#html-style)
- [Marked.js Documentation](https://marked.js.org/)
- [Telegram HTML formatting limitations](https://tgrm.oss.hagever.com/types/Telegram.ParseMode.html)
