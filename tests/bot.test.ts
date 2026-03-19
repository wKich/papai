import { describe, expect, test } from 'bun:test'

import { formatLlmOutput } from '../src/chat/telegram/format.js'

describe('bot message formatting', () => {
  test('formatLlmOutput converts markdown to entities', () => {
    const result = formatLlmOutput('**bold** text')
    expect(result.text).toBe('bold text')
    expect(result.entities).toHaveLength(1)
    const firstEntity = result.entities[0]!
    expect(firstEntity.type).toBe('bold')
  })

  test('formatLlmOutput handles plain text', () => {
    const result = formatLlmOutput('plain text')
    expect(result.text).toBe('plain text')
    expect(result.entities).toHaveLength(0)
  })
})
