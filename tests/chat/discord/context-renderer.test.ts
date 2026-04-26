import { describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { renderDiscordContext } from '../../../src/chat/discord/context-renderer.js'
import type { ContextRendered, ContextSnapshot } from '../../../src/chat/types.js'

function assertEmbed(result: ContextRendered): asserts result is Extract<ContextRendered, { method: 'embed' }> {
  assert(result.method === 'embed', 'expected embed method')
}

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

describe('renderDiscordContext', () => {
  test('returns embed method with Context title', () => {
    const result = renderDiscordContext(snapshot)
    expect(result.method).toBe('embed')
    assertEmbed(result)
    expect(result.embed.title).toBe('Context · gpt-4o')
  })

  test('description contains the emoji grid', () => {
    const result = renderDiscordContext(snapshot)
    assertEmbed(result)
    expect(result.embed.description).toContain('🟦')
    expect(result.embed.description).toContain('⬜')
  })

  test('has one field per top-level section', () => {
    const result = renderDiscordContext(snapshot)
    assertEmbed(result)
    expect(result.embed.fields?.map((f) => f.name)).toEqual([
      '🟦 System prompt',
      '🟩 Memory context',
      '🟨 Conversation history',
      '🟪 Tools',
    ])
  })

  test('section fields list child tokens in their values', () => {
    const result = renderDiscordContext(snapshot)
    assertEmbed(result)
    const systemField = result.embed.fields?.find((f) => f.name === '🟦 System prompt')
    expect(systemField?.value).toContain('820')
    expect(systemField?.value).toContain('Base instructions')
    expect(systemField?.value).toContain('Custom instructions')
    expect(systemField?.value).toContain('Provider addendum')
  })

  test('footer shows tokens + percentage', () => {
    const result = renderDiscordContext(snapshot)
    assertEmbed(result)
    expect(result.embed.footer).toContain('6,770')
    expect(result.embed.footer).toContain('128,000')
    expect(result.embed.footer).toMatch(/5\.\d%/)
  })

  test('color is green below 50% usage', () => {
    const result = renderDiscordContext(snapshot)
    assertEmbed(result)
    expect(result.embed.color).toBe(0x2ecc71)
  })

  test('color is yellow between 50% and 80% usage', () => {
    const result = renderDiscordContext({ ...snapshot, totalTokens: 80_000 })
    assertEmbed(result)
    expect(result.embed.color).toBe(0xf1c40f)
  })

  test('color is red above 80% usage', () => {
    const result = renderDiscordContext({ ...snapshot, totalTokens: 110_000 })
    assertEmbed(result)
    expect(result.embed.color).toBe(0xe74c3c)
  })

  test('footer omits percentage when maxTokens is null', () => {
    const result = renderDiscordContext({ ...snapshot, maxTokens: null })
    assertEmbed(result)
    expect(result.embed.footer).not.toMatch(/%/)
    expect(result.embed.footer).toContain('6,770 tokens')
  })

  test('notes approximate counts in footer when applicable', () => {
    const result = renderDiscordContext({ ...snapshot, approximate: true })
    assertEmbed(result)
    expect(result.embed.footer).toMatch(/approximate/i)
  })
})
