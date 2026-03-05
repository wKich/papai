import { describe, expect, test } from 'bun:test'

import { formatMarkdownToHtml } from '../../src/utils/markdown.js'

describe('formatMarkdownToHtml', () => {
  test('converts bold text', () => {
    expect(formatMarkdownToHtml('**bold**')).toContain('<b>bold</b>')
  })

  test('converts italic text', () => {
    expect(formatMarkdownToHtml('_italic_')).toContain('<i>italic</i>')
  })

  test('converts links', () => {
    expect(formatMarkdownToHtml('[text](http://example.com)')).toContain('<a href="http://example.com">text</a>')
  })

  test('converts inline code', () => {
    expect(formatMarkdownToHtml('`code`')).toContain('<code>code</code>')
  })

  test('converts code blocks', () => {
    const result = formatMarkdownToHtml('```typescript\nconsole.log("hi")\n```')
    expect(result).toContain('<pre><code class="language-typescript">')
    expect(result).toContain('</code></pre>')
  })

  test('converts code blocks without language', () => {
    const result = formatMarkdownToHtml('```\nhello\n```')
    expect(result).toContain('<pre><code>hello')
  })

  test('renders plain text without unsupported tags', () => {
    const result = formatMarkdownToHtml('just text')
    expect(result).toBe('just text')
    expect(result).not.toContain('<p>')
  })

  test('converts headings to bold text', () => {
    expect(formatMarkdownToHtml('# Title')).toContain('<b>Title</b>')
    expect(formatMarkdownToHtml('## Subtitle')).toContain('<b>Subtitle</b>')
    expect(formatMarkdownToHtml('### Small')).toContain('<b>Small</b>')
    expect(formatMarkdownToHtml('# Title')).not.toContain('<h1>')
  })

  test('converts unordered lists to bullet text', () => {
    const result = formatMarkdownToHtml('- one\n- two\n- three')
    expect(result).toContain('• one')
    expect(result).toContain('• two')
    expect(result).toContain('• three')
    expect(result).not.toContain('<ul>')
    expect(result).not.toContain('<li>')
  })

  test('converts ordered lists to numbered text', () => {
    const result = formatMarkdownToHtml('1. first\n2. second')
    expect(result).toContain('1. first')
    expect(result).toContain('2. second')
    expect(result).not.toContain('<ol>')
    expect(result).not.toContain('<li>')
  })

  test('converts blockquotes', () => {
    const result = formatMarkdownToHtml('> quoted text')
    expect(result).toContain('<blockquote>')
    expect(result).toContain('quoted text')
  })

  test('converts strikethrough', () => {
    expect(formatMarkdownToHtml('~~deleted~~')).toContain('<s>deleted</s>')
  })

  test('converts hr to newline', () => {
    const result = formatMarkdownToHtml('above\n\n---\n\nbelow')
    expect(result).not.toContain('<hr')
  })

  test('converts br to newline', () => {
    const result = formatMarkdownToHtml('line one  \nline two')
    expect(result).not.toContain('<br')
  })

  test('handles mixed formatting', () => {
    const result = formatMarkdownToHtml('**bold** and _italic_ and `code`')
    expect(result).toContain('<b>bold</b>')
    expect(result).toContain('<i>italic</i>')
    expect(result).toContain('<code>code</code>')
  })

  test('converts markdown in under 50ms for 1KB', () => {
    const largeMarkdown = '-'.repeat(3000)
    // Warmup to avoid cold-start overhead
    formatMarkdownToHtml('warmup')
    const start = performance.now()
    formatMarkdownToHtml(largeMarkdown)
    const duration = performance.now() - start
    expect(duration).toBeLessThan(50)
  })
})
