import { describe, expect, test } from 'bun:test'

import { formatLlmOutput } from '../../../src/chat/discord/format.js'

describe('formatLlmOutput (Discord)', () => {
  test('returns plain text unchanged for simple input', () => {
    const chunks = formatLlmOutput('hello world')
    expect(chunks).toEqual(['hello world'])
  })

  test('preserves **bold**, *italic*, `code`, and fenced blocks', () => {
    const input = '**strong** and *em* and `code` and\n```\nblock\n```'
    const chunks = formatLlmOutput(input)
    expect(chunks.length).toBe(1)
    expect(chunks[0]).toContain('**strong**')
    expect(chunks[0]).toContain('*em*')
    expect(chunks[0]).toContain('`code`')
    expect(chunks[0]).toContain('```\nblock\n```')
  })

  test('escapes @everyone and @here to prevent mass pings', () => {
    const input = 'hey @everyone and @here look'
    const chunks = formatLlmOutput(input)
    expect(chunks[0]).not.toContain('@everyone')
    expect(chunks[0]).not.toContain('@here')
    expect(chunks[0]).toContain('@\u200beveryone')
    expect(chunks[0]).toContain('@\u200bhere')
  })

  test('flattens a markdown table to pipe-separated rows', () => {
    const input = '| col1 | col2 |\n| --- | --- |\n| a    | b    |\n| c    | d    |'
    const chunks = formatLlmOutput(input)
    expect(chunks[0]).toContain('col1 | col2')
    expect(chunks[0]).toContain('a | b')
    expect(chunks[0]).toContain('c | d')
    expect(chunks[0]).not.toMatch(/^\|\s*-/m)
  })

  test('chunks output longer than 2000 chars into multiple strings', () => {
    const input = 'paragraph one\n\n' + 'x'.repeat(3000)
    const chunks = formatLlmOutput(input)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000)
    }
  })
})
