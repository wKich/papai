import { describe, expect, test } from 'bun:test'

import { formatMarkdownToHtml } from '../../src/utils/markdown.js'

describe('formatMarkdownToHtml', () => {
  test('converts bold text', () => {
    const input = '**bold**'
    const result = formatMarkdownToHtml(input)
    expect(result).toContain('<strong>bold</strong>')
  })

  test('converts italic text', () => {
    const input = '_italic_'
    const result = formatMarkdownToHtml(input)
    expect(result).toContain('<em>italic</em>')
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
