# Telegram Markdown Formatting via Message Entities

**Date:** 2026-03-06
**Status:** Approved for implementation

---

## Overview

This design addresses formatting of messages between the LLM and Telegram. Instead of converting Markdown to HTML and using `parse_mode='HTML'` (which causes 400 Bad Request errors for unsupported tags), we convert Markdown directly to Telegram's native `MessageEntity` format and send messages with the `entities` parameter.

---

## Requirements

**User Requirements:**

1. LLM outputs raw Markdown
2. Bold, italic, links, code blocks, blockquotes, headers, and lists should render correctly
3. No 400 Bad Request errors from unsupported HTML tags
4. Malformed markdown should gracefully degrade to plain text
5. No changes to system prompt - LLM already knows how to format Markdown

**Technical Constraints:**

- Use @gramio/format library for Markdown to entities conversion
- No parse_mode parameter when sending messages with entities
- Minimal dependencies (marked as peer dependency)
- Maintain existing bot architecture

---

## Architecture

```
LLM Output (Markdown)
  ↓
@gramio/format: markdownToFormattable()
  ↓
{ text: string, entities: MessageEntity[] }
  ↓
grammy: ctx.reply(text, { entities })
  ↓
Telegram renders with formatting
```

**Key principle:** Send text with `entities` array instead of using `parse_mode`. This bypasses Telegram's HTML/Markdown parser entirely, eliminating validation errors.

---

## Component Design

### 1. Format Converter (`src/utils/format.ts`)

**Purpose:** Convert LLM Markdown output to Telegram-compatible MessageEntity format.

**Implementation:**

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

**Configuration:**

No configuration needed. @gramio/format uses marked internally with sensible defaults.

**Supported Markdown Elements:**

| Markdown                | Telegram Entity | Notes                               |
| ----------------------- | --------------- | ----------------------------------- |
| `**bold**` / `__bold__` | `bold`          |                                     |
| `*italic*` / `_italic_` | `italic`        |                                     |
| `~~strikethrough~~`     | `strikethrough` |                                     |
| `[text](url)`           | `text_link`     |                                     |
| `` `code` ``            | `code`          |                                     |
| ` ```lang\ncode\n``` `  | `pre`           | With optional language              |
| `> quote`               | `blockquote`    |                                     |
| `# Heading`             | `bold`          | All header levels converted to bold |
| `- item` / `1. item`    | Plain text      | With `- ` or `1. ` prefix           |

**Error Handling:**

- Malformed markdown gracefully degrades to plain text
- Invalid URLs in links rendered as plain text
- Unsupported features stripped or converted to plain text
- Never throws - always returns valid FormattableString

**Logging:**

- `debug` on entry (markdown length)
- `debug` on exit (text length, entity count)

---

### 2. Bot Integration (`src/bot.ts`)

**Changes Required:**

**A. Add import at top:**

```typescript
import { formatLlmOutput } from './utils/format.js'
```

**B. Update `callLlm` function (around line 106):**

```typescript
// Before:
const assistantText = result.text
conversationHistory.set(userId, [...history, ...result.response.messages])
await ctx.reply(assistantText || 'Done.')

// After:
const assistantText = result.text
const formatted = formatLlmOutput(assistantText || 'Done.')
conversationHistory.set(userId, [...history, ...result.response.messages])
await ctx.reply(formatted.text, { entities: formatted.entities })
```

**Key Changes:**

1. Convert LLM output using `formatLlmOutput()`
2. Send with `entities` option instead of `parse_mode`
3. No HTML parsing - native Telegram entity format

---

### 3. Dependencies (`package.json`)

**Add to dependencies:**

```json
{
  "@gramio/format": "^0.5.0",
  "marked": "^15.0.0"
}
```

**Rationale:**

- `@gramio/format`: Framework-agnostic library specifically designed for converting Markdown to Telegram entities
- `marked`: Peer dependency required by @gramio/format for Markdown parsing

---

## Testing Strategy

### Unit Tests (`tests/utils/format.test.ts`)

**Test Cases:**

1. **Bold formatting:**

   ```typescript
   test('converts bold text to entities', () => {
     const result = formatLlmOutput('**bold**')
     expect(result.text).toBe('bold')
     expect(result.entities).toContainEqual({ type: 'bold', offset: 0, length: 4 })
   })
   ```

2. **Italic formatting:**

   ```typescript
   test('converts italic text to entities', () => {
     const result = formatLlmOutput('*italic*')
     expect(result.text).toBe('italic')
     expect(result.entities).toContainEqual({ type: 'italic', offset: 0, length: 6 })
   })
   ```

3. **Links:**

   ```typescript
   test('converts links to entities', () => {
     const result = formatLlmOutput('[text](http://example.com)')
     expect(result.text).toBe('text')
     expect(result.entities).toContainEqual({
       type: 'text_link',
       offset: 0,
       length: 4,
       url: 'http://example.com',
     })
   })
   ```

4. **Code blocks:**

   ````typescript
   test('converts code blocks to pre entities', () => {
     const result = formatLlmOutput('```typescript\nconsole.log("hi")\n```')
     expect(result.text).toBe('console.log("hi")')
     expect(result.entities).toContainEqual({
       type: 'pre',
       offset: 0,
       length: 17,
       language: 'typescript',
     })
   })
   ````

5. **Headers to bold:**

   ```typescript
   test('converts headers to bold entities', () => {
     const result = formatLlmOutput('# Title')
     expect(result.text).toBe('Title')
     expect(result.entities).toContainEqual({ type: 'bold', offset: 0, length: 5 })
   })
   ```

6. **Malformed markdown:**
   ```typescript
   test('handles unclosed bold gracefully', () => {
     const result = formatLlmOutput('**unclosed')
     expect(result.text).toBe('**unclosed')
     expect(result.entities).toHaveLength(0)
   })
   ```

### Integration Tests (`tests/bot.test.ts`)

**Test Cases:**

1. **Verify entities are passed:**
   ```typescript
   test('sends messages with entities', async () => {
     const mockCtx = {
       reply: (text: string, options?: any) => {
         expect(options).toHaveProperty('entities')
         expect(options.entities).toBeInstanceOf(Array)
         return Promise.resolve()
       },
     } as any
     // Test message flow
   })
   ```

---

## Migration Plan

1. **Install dependencies:**

   ```bash
   bun add @gramio/format marked
   ```

2. **Create `src/utils/format.ts`:**

   ```bash
   mkdir -p src/utils
   touch src/utils/format.ts
   # Write formatLlmOutput function
   ```

3. **Update `src/bot.ts`:**
   - Add import for formatLlmOutput
   - Update ctx.reply call to use entities

4. **Create unit tests:**

   ```bash
   mkdir -p tests/utils
   touch tests/utils/format.test.ts
   # Write comprehensive tests
   ```

5. **Run tests:**

   ```bash
   bun test
   ```

6. **Test manually:**
   - Send message with `**bold**`
   - Verify Telegram renders bold
   - Send message with `[link](url)`
   - Verify clickable link
   - Send malformed markdown
   - Verify no errors, plain text rendered

---

## Future Considerations

1. **Message length limits:**
   - Telegram limits messages to 4096 characters
   - Consider splitting long messages if needed
   - @gramio/format preserves entity offsets correctly when splitting

2. **Additional formatting:**
   - Underline (`__text__`) supported by @gramio/format
   - Spoilers (`||spoiler||`) supported
   - Expandable blockquotes supported

3. **Performance:**
   - @gramio/format is fast (uses marked internally)
   - No HTML parsing overhead
   - Suitable for real-time bot responses

---

## References

- [@gramio/format documentation](https://gramio.dev/formatting/)
- [Telegram MessageEntity API](https://core.telegram.org/bots/api#messageentity)
- [@telegraf/entity comparison](https://github.com/telegraf/entity) - not suitable due to strict validation
- [Grammy parse-mode plugin](https://grammy.dev/ref/parse-mode/) - build-only, no markdown parsing
