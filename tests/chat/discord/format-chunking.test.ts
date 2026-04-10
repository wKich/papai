import { describe, expect, test } from 'bun:test'

import { chunkForDiscord } from '../../../src/chat/discord/format-chunking.js'

describe('chunkForDiscord', () => {
  test('returns a single chunk for input shorter than max', () => {
    const result = chunkForDiscord('short text', 2000)
    expect(result).toEqual(['short text'])
  })

  test('returns single-element array for empty input', () => {
    expect(chunkForDiscord('', 2000)).toEqual([''])
  })

  test('splits on paragraph boundary preferentially', () => {
    const first = 'a'.repeat(1500)
    const second = 'b'.repeat(1500)
    const input = `${first}\n\n${second}`
    const chunks = chunkForDiscord(input, 2000)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]!.trim()).toBe(first)
    expect(chunks[1]!.trim()).toBe(second)
  })

  test('respects the max length boundary exactly', () => {
    const input = 'x'.repeat(4000)
    const chunks = chunkForDiscord(input, 2000)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000)
    }
    expect(chunks.join('')).toBe(input)
  })

  test('preserves fenced code blocks across chunks by re-opening them', () => {
    const codeBlock = '```\n' + 'code line\n'.repeat(300) + '```'
    const chunks = chunkForDiscord(codeBlock, 2000)
    for (const chunk of chunks) {
      const openCount = (chunk.match(/```/g) ?? []).length
      expect(openCount % 2).toBe(0)
    }
    expect(chunks.every((c) => c.length <= 2000)).toBe(true)
  })

  test('handles exactly-max-length input without splitting', () => {
    const input = 'y'.repeat(2000)
    expect(chunkForDiscord(input, 2000)).toEqual([input])
  })

  test('splits at sentence boundary when no paragraph break exists', () => {
    const sentence1 = 'A'.repeat(1500) + '. '
    const sentence2 = 'B'.repeat(400) + '.'
    const chunks = chunkForDiscord(sentence1 + sentence2, 2000)
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    expect(chunks.every((c) => c.length <= 2000)).toBe(true)
    expect(chunks.join('').replace(/\s+/g, '')).toBe((sentence1 + sentence2).replace(/\s+/g, ''))
  })
})
