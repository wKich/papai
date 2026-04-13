import { describe, expect, test } from 'bun:test'

import { renderTelegramContext } from '../../../src/chat/telegram/context-renderer.js'
import type { ContextSnapshot } from '../../../src/chat/types.js'

const snapshot: ContextSnapshot = {
  modelName: 'gpt-4o',
  totalTokens: 6_770,
  maxTokens: 128_000,
  approximate: false,
  sections: [
    {
      label: 'System prompt',
      tokens: 820,
      children: [
        { label: 'Base instructions', tokens: 650 },
        { label: 'Custom instructions', tokens: 120 },
        { label: 'Provider addendum', tokens: 50 },
      ],
    },
    {
      label: 'Memory context',
      tokens: 350,
      children: [
        { label: 'Summary', tokens: 180 },
        { label: 'Known entities', tokens: 170, detail: '12 facts' },
      ],
    },
    { label: 'Conversation history', tokens: 2_400, detail: '34 messages' },
    { label: 'Tools', tokens: 3_200, detail: '18 active, gated by kaneo' },
  ],
}

describe('renderTelegramContext', () => {
  test('returns a text method result', () => {
    const result = renderTelegramContext(snapshot)
    expect(result.method).toBe('text')
  })

  test('contains header with model and usage', () => {
    const result = renderTelegramContext(snapshot)
    if (result.method !== 'text') throw new Error('expected text')
    expect(result.content).toContain('gpt-4o')
    expect(result.content).toContain('6,770')
    expect(result.content).toContain('128,000')
    expect(result.content).toMatch(/5\.\d%/)
  })

  test('contains the emoji grid', () => {
    const result = renderTelegramContext(snapshot)
    if (result.method !== 'text') throw new Error('expected text')
    expect(result.content).toContain('🟦')
    expect(result.content).toContain('⬜')
  })

  test('wraps detail section in a code block', () => {
    const result = renderTelegramContext(snapshot)
    if (result.method !== 'text') throw new Error('expected text')
    expect(result.content).toContain('```')
    expect(result.content).toContain('System prompt')
    expect(result.content).toContain('820')
    expect(result.content).toContain('Conversation history')
    expect(result.content).toContain('34 messages')
  })

  test('omits percentage when maxTokens is null', () => {
    const result = renderTelegramContext({ ...snapshot, maxTokens: null })
    if (result.method !== 'text') throw new Error('expected text')
    expect(result.content).not.toMatch(/%/)
    expect(result.content).toContain('6,770 tokens')
  })

  test('notes approximate counts when applicable', () => {
    const result = renderTelegramContext({ ...snapshot, approximate: true })
    if (result.method !== 'text') throw new Error('expected text')
    expect(result.content).toMatch(/approximate/i)
  })
})
