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

  describe('link formatting', () => {
    test('converts inline link within a sentence', () => {
      const result = formatLlmOutput('See [ABC-123](https://linear.app/issue/ABC-123) for details')
      expect(result.text).toBe('See ABC-123 for details')
      expect(result.entities).toHaveLength(1)
      expect(result.entities[0]).toMatchObject({
        type: 'text_link',
        offset: 4,
        length: 7,
        url: 'https://linear.app/issue/ABC-123',
      })
    })

    test('converts multiple links in one message', () => {
      const result = formatLlmOutput('See [issue 1](https://linear.app/1) and [issue 2](https://linear.app/2)')
      expect(result.text).toBe('See issue 1 and issue 2')
      expect(result.entities).toHaveLength(2)
      expect(result.entities[0]).toMatchObject({ type: 'text_link', offset: 4, length: 7, url: 'https://linear.app/1' })
      expect(result.entities[1]).toMatchObject({
        type: 'text_link',
        offset: 16,
        length: 7,
        url: 'https://linear.app/2',
      })
    })

    // Bug: @gramio/format has no handler for the "table" token from marked, so the
    // entire table raw text (including "[text](url)" markdown syntax) is passed through
    // as plain text. Links inside tables never become text_link entities.
    test('does not leave raw markdown link syntax in text when link is inside a table', () => {
      const result = formatLlmOutput(
        '| Issue | Link |\n|-------|------|\n| ABC-123 | [ABC-123](https://linear.app/issue/ABC-123) |',
      )
      expect(result.text).not.toContain('](')
      expect(result.entities.some((e) => e.type === 'text_link')).toBe(true)
    })
  })
})
