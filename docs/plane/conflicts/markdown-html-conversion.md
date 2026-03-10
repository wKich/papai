# Conflict Report: Markdown ↔ HTML Conversion for `create-issue`, `get-issue`, `update-issue`

**Date**: March 10, 2026  
**Severity**: Medium — runtime breakage for any non-trivial description  
**Status**: Unresolved — library selection required before implementation

---

## 1. Problem Summary

Linear stores issue descriptions as **CommonMark/GFM Markdown**. Plane stores them as
**HTML** in the `description_html` field, rendered by a TipTap editor built on ProseMirror.

The current mapping stub wraps the raw Markdown string in a `<p>` tag:

```typescript
description_html: description ? `<p>${description}</p>` : undefined
```

This fails for any structured content:

| Linear Markdown input | Current (broken) output  | Expected output                                      |
| --------------------- | ------------------------ | ---------------------------------------------------- |
| `# Heading`           | `<p># Heading</p>`       | `<h1>Heading</h1>`                                   |
| `- [ ] Task`          | `<p>- [ ] Task</p>`      | `<ul data-type="taskList"><li data-type="taskItem"…` |
| `` `code` ``          | `<p>`code`</p>`          | `<p><code>code</code></p>`                           |
| `**bold**`            | `<p>**bold**</p>`        | `<p><strong>bold</strong></p>`                       |
| ` ```js\nfoo\n``` `   | `<p>```js\nfoo\n```</p>` | `<pre><code class="language-js">foo</code></pre>`    |

On read (`get-issue`), `description_html` is returned as TipTap HTML and must be
converted back to Markdown for LLM consumption.

---

## 2. Plane's HTML Schema

### 2.1 Editor Stack

Plane uses **TipTap** (migrated from Remirror in August 2023, PR #1791). TipTap is a
headless wrapper over **ProseMirror**. The `description_html` field is exactly TipTap's
serialised HTML output.

The relevant TipTap extensions active in Plane's rich-text editor (confirmed from
`packages/editor/src/core/extensions/` and `starter-kit.ts`):

| Extension                  | TipTap package                 |
| -------------------------- | ------------------------------ |
| Paragraph                  | StarterKit                     |
| Headings (H1–H6)           | StarterKit                     |
| Bold, Italic, Strike       | StarterKit                     |
| Bullet list / Ordered list | StarterKit (`<ul>`, `<ol>`)    |
| Blockquote                 | `@tiptap/extension-blockquote` |
| Code block (with lowlight) | Custom over StarterKit         |
| Inline code                | Custom mark                    |
| Task list / Task item      | `@tiptap/extension-task-list`  |
| Table                      | `@tiptap/extension-table`      |
| Link                       | `@tiptap/extension-link`       |
| Underline                  | `@tiptap/extension-underline`  |
| Horizontal rule            | Custom                         |

### 2.2 Concrete HTML Tags Expected by Plane

```html
<!-- Paragraph -->
<p>text</p>

<!-- Headings -->
<h1>Title</h1>
<h2>Section</h2>
…
<h6>…</h6>

<!-- Bold / italic / strikethrough / underline / inline code -->
<strong>bold</strong>
<em>italic</em>
<s>strikethrough</s>
<!-- or <del> -->
<u>underline</u>
<code>inline code</code>

<!-- Bullet and ordered lists -->
<ul>
  <li>item</li>
</ul>
<ol>
  <li>item</li>
</ol>

<!-- Task list (TipTap-specific data attributes) -->
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false">
    <label><input type="checkbox" /><span></span></label>
    <div><p>task text</p></div>
  </li>
  <li data-type="taskItem" data-checked="true">
    <label><input type="checkbox" checked /><span></span></label>
    <div><p>done task</p></div>
  </li>
</ul>

<!-- Code block -->
<pre><code class="language-javascript">const x = 1;</code></pre>
<!-- Language-less code block -->
<pre><code>plain code</code></pre>

<!-- Blockquote -->
<blockquote><p>quoted text</p></blockquote>

<!-- Table -->
<table>
  <tbody>
    <tr>
      <th>Header</th>
    </tr>
    <tr>
      <td>Cell</td>
    </tr>
  </tbody>
</table>

<!-- Horizontal rule -->
<hr />

<!-- Link -->
<a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">text</a>

<!-- Image -->
<img src="…" alt="…" />
```

### 2.3 The `description_binary` Field

`description_binary` is a Yjs `Uint8Array` (Y.Doc encoding) consumed by Plane's
collaborative editor. **Avoid it** — generating it requires:

1. Parsing HTML to ProseMirror JSON via `generateJSON` with all TipTap extensions loaded
2. Converting to Y.Doc via `prosemirrorJSONToYDoc`
3. Encoding with `Y.encodeStateAsUpdate`

This has no Node.js-compatible lightweight path and brings a huge dependency tree
(Yjs, `y-prosemirror`, the full `@tiptap` extension set). `description_html` alone is
sufficient; Plane's live server converts HTML to binary on save.

---

## 3. Conversion Direction Analysis

### 3.1 Linear Markdown → Plane HTML (`create-issue`, `update-issue`)

**Input**: CommonMark/GFM string from Linear  
**Output**: TipTap-compatible HTML for `description_html`

Critical transformation points:

1. **Task lists** — GFM `- [ ]`/`- [x]` must produce `<ul data-type="taskList">` with
   `<li data-type="taskItem" data-checked="…">` (not standard `<ul>/<li>`)
2. **Code blocks** — must produce `<pre><code class="language-LANG">` (language class
   required for TipTap's lowlight highlighting to work)
3. **Everything else** — TipTap's `parseHTML` rules accept standard HTML

`marked` (already in papai's `package.json`) produces standard CommonMark HTML.
The only structural divergence is the task list format. A custom renderer override for
the `listitem` token handles this.

### 3.2 Plane HTML → Linear Markdown (`get-issue`)

**Input**: TipTap HTML from Plane's `description_html`  
**Output**: GFM Markdown string for the LLM/bot

Critical notes:

- **Task list HTML** uses `<ul data-type="taskList">` with `<li data-type="taskItem"
data-checked="…">` — standard HTML→Markdown converters will not produce `- [ ]`/`- [x]`
  without custom rules
- Plane's **own codebase** (`packages/utils/src/editor/markdown-parser/root.ts`) uses
  the `unified`/`rehype`/`remark` pipeline for this direction — confirmed from source
- `turndown` with GFM plugin handles tables and fenced code blocks; requires one custom
  rule for TipTap's task list structure

---

## 4. Library Comparison

### 4.1 Markdown → HTML Libraries

|                       | `marked`                        | `markdown-it`                 | `unified/remark`            |
| --------------------- | ------------------------------- | ----------------------------- | --------------------------- |
| **Already installed** | ✅ Yes (v17)                    | ❌ No                         | ❌ No                       |
| **GFM support**       | ✅ gfm option                   | ✅ gfm plugin                 | ✅ remark-gfm               |
| **Custom renderer**   | ✅ Simple override              | ✅ Rule override              | ✅ AST plugin               |
| **Bundle size**       | ~15 kB                          | ~28 kB                        | ~60 kB + plugins            |
| **Sync API**          | ✅ `marked.parse()`             | ✅ `.render()`                | ⚠️ `processSync`            |
| **TipTap task list**  | Custom renderer needed          | Custom rule needed            | Custom plugin needed        |
| **Code block class**  | ✅ Emits `class="language-*"`   | ✅ Emits `class="language-*"` | ✅ Via rehype               |
| **Maturity**          | ⭐⭐⭐⭐ (10yr, 36k★)           | ⭐⭐⭐⭐ (35k★)               | ⭐⭐⭐⭐ (many pkgs)        |
| **Verdict**           | **Preferred** (already present) | Good alternative              | Overkill for this direction |

### 4.2 HTML → Markdown Libraries

|                            | `turndown`                         | `unified/rehype+remark`                                              | Custom parser             |
| -------------------------- | ---------------------------------- | -------------------------------------------------------------------- | ------------------------- |
| **Installation needed**    | `turndown` + `turndown-plugin-gfm` | `rehype-parse` + `rehype-remark` + `remark-gfm` + `remark-stringify` | None                      |
| **GFM tables**             | ✅ Via GFM plugin                  | ✅ Via remark-gfm                                                    | ❌ Expensive to implement |
| **Fenced code blocks**     | ✅ `codeBlockStyle: 'fenced'`      | ✅                                                                   | Parseable but tedious     |
| **TipTap task list**       | ✅ One custom rule                 | ✅ rehypeRemark handler                                              | Parseable                 |
| **Underline**              | ❌ Stripped (no MD equiv.)         | ❌ Stripped                                                          | ❌ Stripped               |
| **What Plane itself uses** | ❌                                 | ✅ **Yes — exact match**                                             | ❌                        |
| **Sync API**               | ✅ `.turndown()`                   | ✅ `processSync()`                                                   | —                         |
| **Bundle size**            | ~7 kB + ~3 kB                      | ~80 kB total                                                         | 0                         |
| **Maturity**               | ⭐⭐⭐⭐ (11k★)                    | ⭐⭐⭐⭐⭐                                                           | —                         |
| **Verdict**                | **Preferred** (simpler, less deps) | Valid if unified already in project                                  | Not recommended           |

### 4.3 Rejected Options

**`@tryfabric/martian`**: Designed for Jira's Atlassian Document Format (ADF), not
HTML. Irrelevant for a TipTap/HTML interop problem.

**`showdown`**: Bidirectional but produces less-standard HTML; last major release 2019.
Listed only for completeness.

**`@makeplane/lite-text-editor`**: No server-side converter is exported by the package.
The live-server endpoint (`/api/v1/convert/description_html`) only exists in self-hosted
Plane ≥ v0.24 and requires network access — unusable for a migration tool that must work
offline.

---

## 5. Round-Trip Fidelity

### Architectural Constraint

The full data flow in papai is:

```
A  LLM output Markdown
   → markdownToFormattable (marked + @gramio/format) →
B  Telegram HTML / MessageEntity

B  Plane HTML (description_html)
   → htmlToMarkdown →
C  LLM input Markdown

C  LLM input Markdown
   → markdownToFormattable (same pipeline as A→B) →
B' Telegram HTML / MessageEntity
```

**The invariant is B' ≈ B** — what the LLM reads back from Plane, when rendered to Telegram, must produce output equivalent to what the LLM originally wrote.

This means `htmlToMarkdown` is not a general HTML→Markdown converter. It must produce **Markdown in the exact subset that `marked` (with `gfm: true`, the config used by `@gramio/format`) can faithfully round-trip**. Any Markdown idiom that `marked` does not handle will break the invariant.

Practical implications for `turndown` configuration:

| Turndown option       | Required value    | Reason                                                            |
| --------------------- | ----------------- | ----------------------------------------------------------------- |
| `headingStyle`        | `'atx'` (`# H1`)  | `marked` parses both, but ATX is the canonical form               |
| `codeBlockStyle`      | `'fenced'`        | `marked` renders fenced blocks with `class="language-*"`          |
| `fence`               | ``'`\`\`'``       | Match `marked`'s expected delimiter                               |
| `bulletListMarker`    | `'-'`             | `marked` handles all; `-` matches LLM output convention           |
| `strongDelimiter`     | `'**'`            | `marked` renders `**` as `<strong>`; `__` is also valid but avoid |
| TipTap task list rule | `- [ ]` / `- [x]` | `marked` with `gfm: true` converts these to list items            |

The LLM reads Markdown and writes Markdown — it never sees HTML. The HTML is only an intermediate representation for Plane storage. As long as `htmlToMarkdown` outputs Markdown that `marked` processes identically to typical LLM Markdown output, the pipeline is consistent.

### Element-level fidelity table

Round-trip = Plane HTML → turndown → marked → Telegram MessageEntity. The LLM only ever sees
Markdown, so HTML is an intermediate representation. Perfect round-trip is not required,
but semantic equivalence is.

| Content type                | marked output                        | turndown re-parse         | Fidelity                                |
| --------------------------- | ------------------------------------ | ------------------------- | --------------------------------------- |
| Plain paragraphs            | `<p>text</p>`                        | `text`                    | ✅ Perfect                              |
| Headings `#…######`         | `<h1>…<h6>`                          | `# …###### `              | ✅ Perfect (ATX style)                  |
| Bold `**text**`             | `<strong>text</strong>`              | `**text**`                | ✅ Perfect                              |
| Italic `*text*`             | `<em>text</em>`                      | `_text_`                  | ⚠️ Delimiter change, semantically equal |
| Strikethrough `~~text~~`    | `<del>text</del>`                    | `~~text~~`                | ✅ With GFM plugin                      |
| Inline code `` `code` ``    | `<code>code</code>`                  | `` `code` ``              | ✅ Perfect                              |
| Fenced code block           | `<pre><code class="language-js">`    | ` ```js ` fenced          | ✅ With `codeBlockStyle: 'fenced'`      |
| Bullet list                 | `<ul><li>`                           | `- item`                  | ✅ Perfect                              |
| Ordered list                | `<ol><li>`                           | `1. item`                 | ✅ Perfect                              |
| Nested lists                | `<ul><li><ul>…`                      | Indented `  - sub`        | ✅ Perfect                              |
| Task list `- [ ]`           | Custom: `<ul data-type="taskList">…` | Custom rule: `- [ ] text` | ✅ With custom rule                     |
| Tables                      | `<table>…`                           | GFM table                 | ✅ With GFM plugin                      |
| Links                       | `<a href="…">text</a>`               | `[text](url)`             | ✅ Perfect                              |
| Blockquote `>`              | `<blockquote><p>…`                   | `> text`                  | ✅ Perfect                              |
| Horizontal rule `---`       | `<hr>`                               | `---`                     | ✅ Perfect                              |
| Underline (Linear has none) | N/A                                  | `<u>` stripped            | ✅ N/A                                  |
| Images `![alt](url)`        | `<img src alt>`                      | `![alt](url)`             | ✅ Perfect                              |
| Linear `@mentions`          | Not parsed (plain text)              | Preserved as text         | ⚠️ Acceptable                           |

**Unavoidable lossy cases:**

- `_italic_` round-trips as `_italic_` (turndown default) — semantically identical
- Tight vs. loose lists: `marked` always wraps list item text in `<p>` for loose lists; turndown includes the `<p>` correctly

---

## 6. Recommended Approach

### Decision

| Direction       | Library                                | Rationale                                                                |
| --------------- | -------------------------------------- | ------------------------------------------------------------------------ |
| Markdown → HTML | **`marked`** (already installed)       | Zero additional dependencies; custom renderer for task lists is 15 lines |
| HTML → Markdown | **`turndown`** + `turndown-plugin-gfm` | Minimal, battle-tested; single custom rule for TipTap task lists         |

**Why not `unified` for HTML→Markdown?** Although Plane's own source uses it, that's
within their full editor stack where the packages are already bundled. Adding `rehype-parse`

- `rehype-remark` + `remark-gfm` + `remark-stringify` to papai adds ~8 packages and ~80 kB
  for the same outcome achievable with `turndown` + one plugin (~10 kB total). Turndown's
  simpler mental model also makes the custom task-list rule easier to reason about.

---

## 7. Implementation Sketch

### 7.1 `markdownToHtml` (for create/update)

```typescript
import { marked, Renderer } from 'marked'

// Build a custom renderer that emits TipTap-compatible task-list HTML
const renderer = new Renderer()

// Intercept list items that contain a checkbox token (GFM task list item)
const originalListitem = renderer.listitem.bind(renderer)
renderer.listitem = (token) => {
  if (token.task) {
    const checked = token.checked === true
    const inner = token.text // marked already renders the inner content
    return (
      `<li data-type="taskItem" data-checked="${checked}">` +
      `<label><input type="checkbox"${checked ? ' checked' : ''}><span></span></label>` +
      `<div><p>${inner}</p></div>` +
      `</li>`
    )
  }
  return originalListitem(token)
}

// Wrap task lists in the data-type="taskList" ul
const originalList = renderer.list.bind(renderer)
renderer.list = (token) => {
  if (token.items.some((item) => item.task)) {
    const body = token.items.map((item) => renderer.listitem(item)).join('')
    return `<ul data-type="taskList">${body}</ul>`
  }
  return originalList(token)
}

marked.use({ renderer })

export function markdownToHtml(markdown: string): string {
  return marked.parse(markdown, { gfm: true }) as string
}
```

**Note on code blocks**: `marked` with `gfm: true` already emits
`<pre><code class="language-LANG">` when a fenced block specifies a language — this
is exactly what TipTap's `CodeBlockLowlight` extension expects. No custom override
needed.

### 7.2 `htmlToMarkdown` (for get-issue)

The output must be Markdown that `marked` (with `gfm: true`) can reproduce as equivalent
HTML — i.e. the same dialect that `@gramio/format`'s `markdownToFormattable` consumes.
Configure `turndown` accordingly.

````typescript
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

const td = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  fence: '```',
  bulletListMarker: '-',
  strongDelimiter: '**',
})

td.use(gfm) // enables GFM tables, task lists (standard), strikethrough

// Override for TipTap's task list structure:
// <ul data-type="taskList"> … <li data-type="taskItem" data-checked="true/false">
td.addRule('tiptapTaskList', {
  filter: (node) => node.nodeName === 'UL' && node.getAttribute('data-type') === 'taskList',
  replacement: (_content, node) => {
    const items = Array.from(node.querySelectorAll('li[data-type="taskItem"]'))
    return items
      .map((li) => {
        const checked = li.getAttribute('data-checked') === 'true'
        const div = li.querySelector('div')
        const text = td.turndown(div?.innerHTML ?? '').trim()
        return `- [${checked ? 'x' : ' '}] ${text}`
      })
      .join('\n')
  },
})

export function htmlToMarkdown(html: string): string {
  if (!html || html === '<p></p>') return ''
  return td.turndown(html)
}
````

### 7.3 Module Layout

```
src/plane/
  description.ts     ← exports markdownToHtml() and htmlToMarkdown()

tests/plane/
  description.test.ts
```

---

## 8. Test Cases

The test file should cover the following input/output pairs. All test inputs come directly
from common Linear issue description patterns observed in practice.

### 8.1 Markdown → HTML

````typescript
// 1. Plain paragraph
markdownToHtml('Hello world')
// → '<p>Hello world</p>\n'

// 2. Heading
markdownToHtml('# Title\n\nText')
// → '<h1>Title</h1>\n<p>Text</p>\n'

// 3. Fenced code block with language
markdownToHtml('```typescript\nconst x = 1\n```')
// → '<pre><code class="language-typescript">const x = 1\n</code></pre>\n'

// 4. Unchecked task list
markdownToHtml('- [ ] Do something\n- [x] Already done')
// → '<ul data-type="taskList">'
//   + '<li data-type="taskItem" data-checked="false">...'
//   + '<li data-type="taskItem" data-checked="true">...'
//   + '</ul>'

// 5. Nested lists
markdownToHtml('- Item 1\n  - Sub-item\n- Item 2')
// → standard nested <ul><li><ul><li> structure

// 6. Table
markdownToHtml('| Col A | Col B |\n|---|---|\n| 1 | 2 |')
// → '<table>…</table>'

// 7. Inline elements
markdownToHtml('**bold** _italic_ ~~strike~~ `code` [link](http://x.com)')
// → '<p><strong>bold</strong> <em>italic</em> <del>strike</del> <code>code</code> <a href="http://x.com">link</a></p>\n'
````

### 8.2 HTML → Markdown

````typescript
// 1. Plain paragraph
htmlToMarkdown('<p>Hello world</p>')
// → 'Hello world'

// 2. Heading
htmlToMarkdown('<h2>Section</h2>')
// → '## Section'

// 3. Code block with language
htmlToMarkdown('<pre><code class="language-python">print("hi")</code></pre>')
// → '```python\nprint("hi")\n```'

// 4. TipTap task list
const taskHtml = `<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false">
    <label><input type="checkbox"><span></span></label>
    <div><p>Do something</p></div>
  </li>
  <li data-type="taskItem" data-checked="true">
    <label><input type="checkbox" checked><span></span></label>
    <div><p>Already done</p></div>
  </li>
</ul>`
htmlToMarkdown(taskHtml)
// → '- [ ] Do something\n- [x] Already done'

// 5. Table
htmlToMarkdown('<table><tbody><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></tbody></table>')
// → '| A | B |\n| --- | --- |\n| 1 | 2 |'

// 6. Blockquote
htmlToMarkdown('<blockquote><p>Important</p></blockquote>')
// → '> Important'

// 7. Empty / null guard
htmlToMarkdown('<p></p>')
// → ''

htmlToMarkdown('')
// → ''
````

### 8.3 Round-Trip (Markdown → HTML → Markdown)

Semantic equivalence — not character-for-character identity:

````typescript
const cases = [
  '# Title\n\nSome text',
  '**bold** and _italic_',
  '- [ ] Task one\n- [x] Task two',
  '```js\nconsole.log(1)\n```',
  '| Header |\n|---|\n| Cell |',
  '> Blockquote text',
  '[Link](https://example.com)',
]

for (const md of cases) {
  const html = markdownToHtml(md)
  const roundTripped = htmlToMarkdown(html)
  // roundTripped should be semantically equivalent to md
  // (minor delimiter changes like * → _ for italic are acceptable)
}
````

---

## 9. Dependencies to Add

```json
{
  "dependencies": {
    "turndown": "^7.2.0",
    "turndown-plugin-gfm": "^1.0.2"
  },
  "devDependencies": {
    "@types/turndown": "^5.0.5"
  }
}
```

`marked` is **already present** (`^17.0.4`). No additional install needed for the
Markdown→HTML direction.

---

## 10. Open Questions

1. **Linear mentions** (`@username`, `@team`): Linear's Markdown may contain
   `[username](linear://user/…)` mention syntax. Decided: pass through as plain links
   — the LLM can render them as text. Plane mentions use a custom extension not
   addressable from the API anyway.

2. **Plane → Linear description updates**: If the user edits a description in Plane
   directly (e.g. via the web app) and the bot later fetches it, the HTML may contain
   Plane-only constructs (callouts, embeds, work-item embeds). These will be stripped
   to text by `turndown` — acceptable loss, since Linear has no equivalent.

3. **Image URLs**: Linear issue descriptions may embed Cloudflare-proxied image URLs.
   Plane's CDN expects images to be uploaded through its asset API. For now, `<img>`
   tags are preserved as-is; broken images are a known limitation.

4. **`description_binary` population**: Even if `description_html` is set correctly,
   Plane's live server may not auto-populate `description_binary` on work item create
   via the API. Should be verified against the actual Plane REST API behaviour for
   collaborative editing to work on the issue.
