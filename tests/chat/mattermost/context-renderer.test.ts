import { describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { renderMattermostContext } from '../../../src/chat/mattermost/context-renderer.js'
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

describe('renderMattermostContext', () => {
  test('returns a formatted method result', () => {
    const result = renderMattermostContext(snapshot)
    expect(result.method).toBe('formatted')
  })

  test('contains bold header with model and usage', () => {
    const result = renderMattermostContext(snapshot)
    assert(result.method === 'formatted')
    expect(result.content).toContain('**Context**')
    expect(result.content).toContain('gpt-4o')
    expect(result.content).toContain('6,770')
    expect(result.content).toContain('128,000')
  })

  test('contains a markdown table', () => {
    const result = renderMattermostContext(snapshot)
    assert(result.method === 'formatted')
    expect(result.content).toContain('| Section')
    expect(result.content).toContain('| ------ | ------')
  })

  test('table rows use section emojis', () => {
    const result = renderMattermostContext(snapshot)
    assert(result.method === 'formatted')
    expect(result.content).toContain('| 🟦 **System prompt**')
    expect(result.content).toContain('| 🟩 **Memory context**')
    expect(result.content).toContain('| 🟨 **Conversation history**')
    expect(result.content).toContain('| 🟪 **Tools**')
  })

  test('contains the emoji grid', () => {
    const result = renderMattermostContext(snapshot)
    assert(result.method === 'formatted')
    expect(result.content).toContain('🟦')
    expect(result.content).toContain('⬜')
  })

  test('notes approximate counts when applicable', () => {
    const result = renderMattermostContext({ ...snapshot, approximate: true })
    assert(result.method === 'formatted')
    expect(result.content).toMatch(/_token counts are approximate_/i)
  })
})
